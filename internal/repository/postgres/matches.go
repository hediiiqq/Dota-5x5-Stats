package postgres

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/paralin/go-dota2/protocol"
)

func SaveMatch(ctx context.Context, db *pgxpool.Pool, matchId uint64, startedAt time.Time, duration uint32, gameMode protocol.DOTA_GameMode, lobbyType uint32, rawData []byte) error {

	_, err := db.Exec(ctx, `
	INSERT INTO public.matches (dota_match_id,started_at,duration,game_mode,lobby_type, raw_data)
	VALUES ($1, $2, $3, $4, $5, $6)
	ON CONFLICT (dota_match_id) DO NOTHING
`, matchId, startedAt, duration, gameMode, lobbyType, rawData)
	if err != nil {
		log.Printf("failed to save match: %v", err)
		return err
	}
	log.Printf("saved match: %v", matchId)
	return err
}

func CheckMatch(ctx context.Context, db *pgxpool.Pool, matchId uint64) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
	SELECT EXISTS (SELECT 1 FROM public.matches WHERE dota_match_id = $1)
`, matchId).Scan(&exists)
	if err != nil {
		log.Printf("failed to check match: %v", err)
		return exists, err
	}
	return exists, nil
}
