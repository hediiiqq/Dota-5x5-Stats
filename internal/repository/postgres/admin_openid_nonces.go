package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func SaveAdminOpenIDNonce(ctx context.Context, db *pgxpool.Pool, nonce string, expiresAt time.Time) (bool, error) {

	tag, err := db.Exec(ctx, `
insert into public.admin_openid_nonces (nonce, expires_at) 
values ($1, $2)
on conflict (nonce) do nothing
`, nonce, expiresAt)

	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	return true, nil

}
