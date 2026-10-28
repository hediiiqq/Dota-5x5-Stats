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
