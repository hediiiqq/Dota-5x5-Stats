package postgres

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func CreateAdminSession(ctx context.Context, db *pgxpool.Pool, tokenHash string, steamId64 string, expiresAt time.Time) error {

	_, err := db.Exec(ctx, `
	insert into public.admin_sessions (token_hash, steam_id64, expires_at)
	values ($1, $2, $3)
`, tokenHash, steamId64, expiresAt)
	if err != nil {
		log.Printf("ошибка записи входа")
		return err
	}
	return nil
}

func GetAdminSession(ctx context.Context, db *pgxpool.Pool, tokenHash string) (string, time.Time, bool, error) {

	var steamId64 string
	var expiresAt time.Time

	err := db.QueryRow(ctx, `
 select steam_id64, expires_at from public.admin_sessions where token_hash = $1 
                                                          AND revoked_at IS NULL 
                                                          AND expires_at > now()
`, tokenHash).Scan(&steamId64, &expiresAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}

	if err != nil {
		log.Printf("PostgreSQL: не удалось получить сессию администратора: %v", err)
		return "", time.Time{}, false, err
	}

	return steamId64, expiresAt, true, nil

}

func RevokeAdminSession(ctx context.Context, db *pgxpool.Pool, tokenHash string) error {

	_, err := db.Exec(ctx, `
update public.admin_sessions set revoked_at = now()
                                 where token_hash = $1 and  revoked_at is null
`, tokenHash)
	if err != nil {
		return err
	}
	return nil
}

func RevokeAllAdminSessions(ctx context.Context, db *pgxpool.Pool, steamId64 string) error {

	_, err := db.Exec(ctx, `
update public.admin_sessions set revoked_at = now() where steam_id64 = $1 and  revoked_at is null
`, steamId64)
	if err != nil {
		return err
	}
	return nil
}
