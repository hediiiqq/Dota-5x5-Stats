package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pkg/errors"
)

type ImportEvent struct {
	Id          int64
	CreatedAt   time.Time
	JobId       int64
	Level       string
	DotaMatchId *uint64
	Message     string
	Stage       *string
}

func CreateImportEvent(ctx context.Context, db *pgxpool.Pool, event *ImportEvent) error {

	if event == nil {
		return errors.New("пустой event")
	}

	_, err := db.Exec(ctx, `
insert into public.import_events (job_id,level,stage,dota_match_id,message)
values ($1,$2,$3,$4,$5)
`, event.JobId, event.Level, event.Stage, event.DotaMatchId, event.Message)

	if err != nil {
		return err
	}

	return nil

}

func ListImportEvents(ctx context.Context, db *pgxpool.Pool, limit int64, beforeId *int64) ([]*ImportEvent, error) {

	rows, err := db.Query(ctx, `
SELECT
    id, created_at, job_id, level,
    stage, dota_match_id, message
FROM public.import_events
WHERE ($1::bigint IS NULL OR id < $1::bigint)
ORDER BY id DESC
LIMIT $2
`, beforeId, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]*ImportEvent, 0)
	for rows.Next() {
		event := &ImportEvent{}
		if err := rows.Scan(
			&event.Id, &event.CreatedAt, &event.JobId, &event.Level,
			&event.Stage, &event.DotaMatchId, &event.Message,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil

}
