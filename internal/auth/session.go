package auth

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthenticated = errors.New("требуется вход")
	ErrAdminRequired   = errors.New("нет прав администратора")
)

func CreateSession(ctx context.Context, db *pgxpool.Pool, steamId64 string) (string, time.Time, error) {

	token, err := GenerateSessionToken()
	if err != nil {
		return "", time.Time{}, err
	}

	hash := HashSessionToken(token)

	expiresAt := time.Now().UTC().Add(config.AdminSessionTTL)

	err = postgres.CreateAdminSession(ctx, db, hash, steamId64, expiresAt)

	if err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

func ValidateSession(ctx context.Context, db *pgxpool.Pool, token string, authConfig config.AuthConfig) (string, time.Time, error) {

	if token == "" {
		return "", time.Time{}, ErrUnauthenticated
	}
	hash := HashSessionToken(token)

	steamId64, expiresAt, found, err := postgres.GetAdminSession(ctx, db, hash)

	if err != nil {
		return "", time.Time{}, err
	}

	if !found {
		return "", time.Time{}, ErrUnauthenticated
	}

	adminSteamId64 := authConfig.AdminSteamIDs

	if _, ok := adminSteamId64[steamId64]; !ok {
		return "", time.Time{}, ErrAdminRequired
	}

	return steamId64, expiresAt, nil

}
