package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminLoginAttempt struct {
	BrowserTokenHash string
	ReturnTo         string
	ExpiresAt        time.Time
}

// CreateAdminLoginAttempt saves an attempt prepared by the authentication layer.
// Only hashes of the state and browser token are persisted.
func CreateAdminLoginAttempt(ctx context.Context, db *pgxpool.Pool, stateHash string, browserTokenHash string, returnTo string, expiresAt time.Time) error {
	_, err := db.Exec(ctx, `
		INSERT INTO public.admin_login_attempts
			(state_hash, browser_token_hash, return_to, expires_at)
		VALUES ($1, $2, $3, $4)
	`, stateHash, browserTokenHash, returnTo, expiresAt)
	if err != nil {
		return fmt.Errorf("не удалось сохранить попытку входа администратора: %w", err)
	}
	return nil
}

func GetAdminLoginAttempt(ctx context.Context, db *pgxpool.Pool, stateHash string) (adminLoginAttempt AdminLoginAttempt, found bool, err error) {

	err = db.QueryRow(ctx, `
select browser_token_hash , return_to, expires_at from public.admin_login_attempts where state_hash = $1 and expires_at > now() and used_at IS NULL

`, stateHash).Scan(&adminLoginAttempt.BrowserTokenHash, &adminLoginAttempt.ReturnTo, &adminLoginAttempt.ExpiresAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return AdminLoginAttempt{}, false, nil
	}
	if err != nil {
		return AdminLoginAttempt{}, false, err
	}

	return adminLoginAttempt, true, nil

}

func ConsumeAdminLoginAttempt(ctx context.Context, db *pgxpool.Pool, stateHash string) (bool, error) {

	tag, err := db.Exec(ctx, `
update public.admin_login_attempts set used_at = now() where state_hash = $1 and used_at IS NULL and expires_at > now()
`, stateHash)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	return true, nil
}
