package auth

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SteamLoginStart struct {
	BrowserToken string
	ReturnTo     string
	ExpiresAt    time.Time
}

func PrepareSteamLogin(ctx context.Context, db *pgxpool.Pool, auth config.AuthConfig) (SteamLoginStart, error) {

	state, err := GenerateSessionToken()

	if err != nil {
		return SteamLoginStart{}, err
	}

	expiresAt := time.Now().UTC().Add(10 * time.Minute)

	stateHash := HashSessionToken(state)
	browserToken, err := GenerateSessionToken()

	if err != nil {
		return SteamLoginStart{}, err
	}
	browserTokenHash := HashSessionToken(browserToken)

	callbackURL, err := url.Parse(auth.PublicBaseURL)
	if err != nil {
		return SteamLoginStart{}, err
	}

	callbackURL.Path = "/auth/steam/callback"

	query := callbackURL.Query()
	query.Set("state", state)
	callbackURL.RawQuery = query.Encode()

	returnTo := callbackURL.String()

	err = postgres.CreateAdminLoginAttempt(ctx, db, stateHash, browserTokenHash, returnTo, expiresAt)

	if err != nil {
		return SteamLoginStart{}, err
	}

	return SteamLoginStart{
		BrowserToken: browserToken,
		ReturnTo:     returnTo,
		ExpiresAt:    expiresAt,
	}, nil

}

func BuildSteamLoginURL(returnTo string, publicBaseURL string) string {

	params := url.Values{}

	params.Set("openid.ns", "http://specs.openid.net/auth/2.0")
	params.Set("openid.mode", "checkid_setup")
	params.Set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select")
	params.Set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select")
	params.Set("openid.return_to", returnTo)
	params.Set("openid.realm", publicBaseURL+"/")

	return "https://steamcommunity.com/openid/login?" + params.Encode()

}
