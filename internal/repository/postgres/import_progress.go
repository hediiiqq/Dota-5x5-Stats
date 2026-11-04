package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Counter values are increments, not replacements.
type ImportProgress struct {
	Stage                                         string
	Discovered, Saved, Existing, Filtered, Failed int64
}

func AddImportProgress(ctx context.Context, db *pgxpool.Pool, id int64, p ImportProgress) error {
	tag, err := db.Exec(ctx, `UPDATE public.import_jobs SET
	stage=COALESCE(NULLIF($2,''),stage), discovered=discovered+$3,
	saved=saved+$4, existing=existing+$5, filtered=filtered+$6,
	failed=failed+$7, updated_at=now()
	WHERE id=$1 AND status='running'`, id, p.Stage, p.Discovered, p.Saved, p.Existing, p.Filtered, p.Failed)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("выполняющееся задание не найдено")
	}
	return nil
}

// Call only after acquiring the exclusive worker lock.
func RecoverImportJobs(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, `UPDATE public.import_jobs SET status='failed', stage=NULL,
	finished_at=now(), updated_at=now(),
	error_code='worker_interrupted', error_message='Исполнитель остановился до завершения задания'
	WHERE status='running'`)
	return err
}

// The authenticated identity must be checked before loading history.
func BindImportAccount(ctx context.Context, db *pgxpool.Pool, id string, dotaID uint64) error {
	if dotaID == 0 || dotaID > 4294967295 {
		return errors.New("некорректный Dota Account ID")
	}
	tag, err := db.Exec(ctx, `UPDATE public.import_accounts SET dota_account_id=$2, updated_at=now()
	WHERE id=$1 AND (dota_account_id IS NULL OR dota_account_id=$2)`, id, int64(dotaID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("Steam-аккаунт не совпадает с привязанным аккаунтом импортера")
	}
	return nil
}
