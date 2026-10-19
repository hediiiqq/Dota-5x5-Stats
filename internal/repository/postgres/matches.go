package postgres

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/paralin/go-dota2/protocol"
)

type MatchRow struct {
	ID      int
	RawData []byte
}

func SaveMatch(ctx context.Context, tx pgx.Tx, matchId uint64, startedAt time.Time, duration uint32, gameMode protocol.DOTA_GameMode, lobbyType uint32, rawData []byte) (id int64, inserted bool, err error) {

	err = tx.QueryRow(ctx, `
	INSERT INTO public.matches (dota_match_id,started_at,duration,game_mode,lobby_type, raw_data)
	VALUES ($1, $2, $3, $4, $5, $6 )
	ON CONFLICT (dota_match_id) DO NOTHING
	RETURNING id;
`, matchId, startedAt, duration, gameMode, lobbyType, rawData).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
        SELECT id FROM public.matches WHERE dota_match_id = $1
    `, matchId).Scan(&id)
		if err != nil {
			return 0, false, err
		}
		return id, false, nil
	}
	if err != nil {
		log.Printf("PostgreSQL: не удалось записать матч Dota %d в текущей транзакции: %v", matchId, err)
		return 0, false, err
	}
	return id, true, nil
}

func CheckMatch(ctx context.Context, db *pgxpool.Pool, matchId uint64) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
	SELECT EXISTS (SELECT 1 FROM public.matches WHERE dota_match_id = $1)
`, matchId).Scan(&exists)
	if err != nil {
		log.Printf("PostgreSQL: не удалось проверить наличие матча Dota %d: %v", matchId, err)
		return exists, err
	}
	return exists, nil
}

func GetMatch(ctx context.Context, db *pgxpool.Pool, matchId uint64) (int, []byte, error) {

	var data []byte
	var id int

	err := db.QueryRow(ctx, `
	SELECT id, raw_data FROM public.matches WHERE dota_match_id = $1
`, matchId).Scan(&id, &data)
	if err != nil {
		log.Printf("PostgreSQL: запрос матча по ID Dota %d не вернул данные: %v", matchId, err)
		return 0, nil, err
	}
	return id, data, nil
}

func ListMatches(ctx context.Context, db *pgxpool.Pool, limit, offset int) ([]MatchRow, error) {

	rows, err := db.Query(ctx, `
    SELECT id, raw_data
    FROM public.matches
    ORDER BY started_at DESC, id DESC
    LIMIT $1 OFFSET $2
`, limit, offset)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	matches := make([]MatchRow, 0)

	for rows.Next() {
		var match MatchRow

		if err := rows.Scan(&match.ID, &match.RawData); err != nil {
			return nil, err
		}

		matches = append(matches, match)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return matches, nil
}
