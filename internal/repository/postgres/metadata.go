package postgres

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func SaveMetadata(ctx context.Context, tx pgx.Tx, matchid int64, metadata []byte) error {

	_, err := tx.Exec(ctx, `
	insert into public.match_metadata (match_id,raw_data,updated_at)
	values ($1, $2, $3)
	on conflict (match_id) do update set raw_data = $2 , updated_at = $3
`, matchid, metadata, time.Now())

	if err != nil {
		log.Printf("Ошибка записи метадаты в бд: %v", err)
		return err
	}

	return nil

}

func GetMetadata(ctx context.Context, db *pgxpool.Pool, matchid int64) ([]byte, error) {

	var data []byte

	err := db.QueryRow(ctx, `
	select raw_data from public.match_metadata WHERE match_id = $1
`, matchid).Scan(&data)

	if errors.Is(err, pgx.ErrNoRows) {
		log.Printf("Мета дата для матча отсутствует в бд")
		return nil, nil
	}

	if err != nil {
		log.Printf("PostgreSQL: запрос матча по внутреннему ID %d не вернул данные: %v", matchid, err)
		return nil, err
	}

	return data, nil
}

func HasMatchMetadata(ctx context.Context, db *pgxpool.Pool, dotaId uint64) (bool, error) {
	var exists bool

	err := db.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM public.matches AS m
    JOIN public.match_metadata AS mm ON mm.match_id = m.id
    WHERE m.dota_match_id = $1
)
`, dotaId).Scan(&exists)
	if err != nil {
		log.Printf("PostgreSQL: запрос метадаты матча по Dota Match ID %d не вернул данные: %v", dotaId, err)
		return exists, err
	}
	return exists, nil
}
