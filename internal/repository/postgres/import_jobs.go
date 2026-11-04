package postgres

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ImportJob struct {
	Id           int64
	AccountId    string
	AccountName  string
	Mode         string
	MinMatchId   *uint64
	AfterMatchId *uint64
	Status       string
	Stage        *string
	CreatedAt    time.Time
	StartedAt    *time.Time
	FinishedAt   *time.Time
	UpdatedAt    time.Time
	Discovered   int64
	Saved        int64
	Existing     int64
	Filtered     int64
	Failed       int64
	ErrorCode    *string
	ErrorMessage *string
}

func CreateImportJob(ctx context.Context, db *pgxpool.Pool, accountId string, accountName string, mode string, minMatchId *uint64, afterMatchId *uint64) (*ImportJob, error) {

	job := &ImportJob{}

	err := db.QueryRow(ctx, `
insert into public.import_jobs (account_id,account_name,mode,min_match_id,after_match_id)
values ($1,$2,$3,$4,$5)
RETURNING id, account_id, account_name, mode, min_match_id, after_match_id,status,stage,created_at, started_at, finished_at, updated_at, failed, error_code, error_message, discovered, saved, existing, filtered
`, accountId, accountName, mode, minMatchId, afterMatchId).Scan(&job.Id, &job.AccountId, &job.AccountName, &job.Mode, &job.MinMatchId, &job.AfterMatchId, &job.Status, &job.Stage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt, &job.Failed, &job.ErrorCode, &job.ErrorMessage, &job.Discovered, &job.Saved, &job.Existing, &job.Filtered)

	if err != nil {
		return nil, err
	}
	return job, nil
}

func GetImportJob(ctx context.Context, db *pgxpool.Pool, id int64) (*ImportJob, bool, error) {
	job := &ImportJob{}

	err := db.QueryRow(ctx, `
select id, account_id, account_name, mode, min_match_id, after_match_id,status,stage,created_at, started_at, finished_at, updated_at, failed, error_code, error_message, discovered, saved, existing, filtered
from public.import_jobs 
where id = $1 

`, id).Scan(&job.Id, &job.AccountId, &job.AccountName, &job.Mode, &job.MinMatchId, &job.AfterMatchId, &job.Status, &job.Stage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt, &job.Failed, &job.ErrorCode, &job.ErrorMessage, &job.Discovered, &job.Saved, &job.Existing, &job.Filtered)

	if errors.Is(err, pgx.ErrNoRows) {
		log.Printf("задание отсутствует")
		return nil, false, nil
	}
	if err != nil {
		log.Printf("ошибка получения задания %v", err)
		return nil, false, err
	}
	return job, true, nil
}

func ListImportJobs(ctx context.Context, db *pgxpool.Pool, limit int, beforeId *int64) ([]*ImportJob, error) {

	rows, err := db.Query(ctx, `
SELECT
    id, account_id, account_name, mode,
    min_match_id, after_match_id, status, stage,
    created_at, started_at, finished_at, updated_at,
    failed, error_code, error_message,
    discovered, saved, existing, filtered
FROM public.import_jobs
WHERE ($1::bigint IS NULL OR id < $1::bigint)
ORDER BY id DESC
LIMIT $2

`, beforeId, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]*ImportJob, 0)

	for rows.Next() {
		job := &ImportJob{}
		err = rows.Scan(&job.Id, &job.AccountId, &job.AccountName, &job.Mode, &job.MinMatchId, &job.AfterMatchId, &job.Status, &job.Stage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt, &job.Failed, &job.ErrorCode, &job.ErrorMessage, &job.Discovered, &job.Saved, &job.Existing, &job.Filtered)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return jobs, nil

}

func ClaimImportJob(ctx context.Context, db *pgxpool.Pool) (*ImportJob, error) {

	job := &ImportJob{}

	err := db.QueryRow(ctx, `
UPDATE public.import_jobs
SET status = 'running',
    started_at = now(),
    updated_at = now()
WHERE id = (
    SELECT id
    FROM public.import_jobs
    WHERE status = 'queued'
    ORDER BY id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING
    id, account_id, account_name, mode,
    min_match_id, after_match_id, status, stage,
    created_at, started_at, finished_at, updated_at,
    failed, error_code, error_message,
    discovered, saved, existing, filtered
`).Scan(&job.Id, &job.AccountId, &job.AccountName, &job.Mode, &job.MinMatchId, &job.AfterMatchId, &job.Status, &job.Stage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt, &job.Failed, &job.ErrorCode, &job.ErrorMessage, &job.Discovered, &job.Saved, &job.Existing, &job.Filtered)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return job, nil

}

func FinishImportJob(ctx context.Context, db *pgxpool.Pool, id int64, errorCode *string, errorMessage *string) error {

	if (errorCode == nil && errorMessage != nil) || (errorCode != nil && errorMessage == nil) {

		return errors.New("код и сообщение ошибки должны быть указаны вместе")

	}

	status := "succeeded"
	if errorCode != nil {
		status = "failed"
	}

	exec, err := db.Exec(ctx, `
update public.import_jobs
set status = $1,
    finished_at = now(),
    updated_at = now(),
    stage = null,
    error_code = $2,
    error_message = $3
WHERE id = $4 AND status = 'running'
`, status, errorCode, errorMessage, id)
	if err != nil {
		return err
	}

	if exec.RowsAffected() != 1 {
		return errors.New("выполняющееся задание не найдено")
	}

	return nil

}

func AcquireImportWorkerLock(ctx context.Context, db *pgxpool.Pool) (*pgxpool.Conn, error) {

	acquire, err := db.Acquire(ctx)
	if err != nil {
		return nil, err
	}

	var locked bool

	err = acquire.QueryRow(ctx, `
	SELECT pg_try_advisory_lock(1685025889, 2)
	`).Scan(&locked)

	if err != nil {
		closeCtx, cancelClose := context.WithTimeout(context.Background(), 5*time.Second)
		closeErr := acquire.Conn().Close(closeCtx)
		cancelClose()
		acquire.Release()
		if closeErr != nil {
			return nil, errors.Join(err, closeErr)
		}
		return nil, err
	}

	if !locked {
		acquire.Release()
		return nil, errors.New("исполнитель уже запущен")
	}

	return acquire, nil

}
