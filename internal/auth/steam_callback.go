package auth

import (
	"context"
	"crypto/hmac"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSteamAuthInvalid     = errors.New("попытка входа недействительна")
	ErrSteamAuthUnavailable = errors.New("не удалось проверить ответ Steam")
)

func ValidateSteamLoginAttempt(ctx context.Context, db *pgxpool.Pool, state string, browserToken string) (postgres.AdminLoginAttempt, error) {

	if state == "" || browserToken == "" {
		return postgres.AdminLoginAttempt{}, ErrSteamAuthInvalid
	}

	stateHash := HashSessionToken(state)

	attempt, found, err := postgres.GetAdminLoginAttempt(ctx, db, stateHash)

	if err != nil {
		return postgres.AdminLoginAttempt{}, err
	}

	if !found {
		return postgres.AdminLoginAttempt{}, ErrSteamAuthInvalid
	}

	browserTokenHash := HashSessionToken(browserToken)

	if !hmac.Equal([]byte(browserTokenHash), []byte(attempt.BrowserTokenHash)) {
		return postgres.AdminLoginAttempt{}, ErrSteamAuthInvalid
	}

	return attempt, nil

}

func ValidateSteamOpenIDFields(params url.Values, expectedReturnTo string) (steamId64 string, err error) {

	for _, param := range params {
		if len(param) != 1 {
			return "", ErrSteamAuthInvalid
		}
	}

	if params.Get("openid.ns") != "http://specs.openid.net/auth/2.0" || params.Get("openid.mode") != "id_res" ||
		params.Get("openid.op_endpoint") != "https://steamcommunity.com/openid/login" || params.Get("openid.return_to") != expectedReturnTo ||
		params.Get("openid.identity") != params.Get("openid.claimed_id") {
		return "", ErrSteamAuthInvalid
	}

	if !strings.HasPrefix(params.Get("openid.claimed_id"), "https://steamcommunity.com/openid/id/") {
		return "", ErrSteamAuthInvalid
	}

	id := strings.TrimPrefix(params.Get("openid.claimed_id"), "https://steamcommunity.com/openid/id/")

	if id == "" {
		return "", ErrSteamAuthInvalid
	}

	for _, char := range id {
		if char < '0' || char > '9' {
			return "", ErrSteamAuthInvalid
		}
	}

	numericID, err := strconv.ParseUint(id, 10, 64)
	if err != nil || numericID == 0 {
		return "", ErrSteamAuthInvalid
	}

	if params.Get("openid.sig") == "" || params.Get("openid.assoc_handle") == "" || params.Get("openid.response_nonce") == "" || params.Get("openid.signed") == "" {
		return "", ErrSteamAuthInvalid
	}

	signed := strings.Split(params.Get("openid.signed"), ",")

	signedFields := make(map[string]bool)
	for _, field := range signed {
		signedFields[field] = true
	}

	requiredFields := []string{
		"op_endpoint",
		"claimed_id",
		"identity",
		"return_to",
		"response_nonce",
		"assoc_handle",
	}
	for _, field := range requiredFields {
		if !signedFields[field] {
			return "", ErrSteamAuthInvalid
		}
	}

	return id, nil

}

func ValidateSteamNonce(nonce string, timeNow time.Time) (time.Time, error) {

	if len(nonce) < 20 || len(nonce) > 255 {
		return time.Time{}, ErrSteamAuthInvalid
	}

	nonceTime, err := time.Parse("2006-01-02T15:04:05Z", nonce[:20])
	if err != nil {
		return time.Time{}, ErrSteamAuthInvalid
	}

	if nonceTime.Format("2006-01-02T15:04:05Z") != nonce[:20] {
		return time.Time{}, ErrSteamAuthInvalid
	}

	for _, char := range nonce[20:] {
		if char < 33 || char > 126 {
			return time.Time{}, ErrSteamAuthInvalid
		}
	}

	if nonceTime.Before(timeNow.Add(-10 * time.Minute)) {
		return time.Time{}, ErrSteamAuthInvalid
	}

	if nonceTime.After(timeNow.Add(time.Minute)) {
		return time.Time{}, ErrSteamAuthInvalid
	}

	return nonceTime.Add(11 * time.Minute), nil

}

func CompleteSteamLogin(ctx context.Context, db *pgxpool.Pool, params url.Values, browserToken string, authConfig config.AuthConfig) (token string, expiresAt time.Time, err error) {

	for _, values := range params {
		if len(values) != 1 {
			return "", time.Time{}, ErrSteamAuthInvalid
		}
	}
	state := params.Get("state")

	attempt, err := ValidateSteamLoginAttempt(ctx, db, state, browserToken)
	if err != nil {
		return "", time.Time{}, err
	}

	steamId64, err := ValidateSteamOpenIDFields(params, attempt.ReturnTo)
	if err != nil {
		return "", time.Time{}, err
	}

	responseNonce := params.Get("openid.response_nonce")

	nonceExpiresAt, err := ValidateSteamNonce(responseNonce, time.Now())
	if err != nil {
		return "", time.Time{}, err
	}

	err = VerifySteamOpenIDSignature(ctx, params)
	if err != nil {
		return "", time.Time{}, err
	}

	if _, allowed := authConfig.AdminSteamIDs[steamId64]; !allowed {
		return "", time.Time{}, ErrAdminRequired
	}

	loginAttempt, err := postgres.ConsumeAdminLoginAttempt(ctx, db, HashSessionToken(state))
	if err != nil {
		return "", time.Time{}, err
	}

	if loginAttempt == false {
		return "", time.Time{}, ErrSteamAuthInvalid
	}

	saved, err := postgres.SaveAdminOpenIDNonce(ctx, db, responseNonce, nonceExpiresAt)
	if err != nil {
		return "", time.Time{}, err
	}
	if !saved {
		return "", time.Time{}, ErrSteamAuthInvalid
	}

	return CreateSession(ctx, db, steamId64)

}
