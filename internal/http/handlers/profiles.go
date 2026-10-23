package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ProfileHandler serializes public provider requests. Its state is accessed only
// while holding gate. Credentials and provider bodies never enter error responses.
type ProfileHandler struct {
	token                                       string
	client                                      *http.Client
	openDotaURL, stratzURL                      string
	openDotaTimeout, stratzTimeout, minInterval time.Duration
	gate                                        chan struct{}
	lastRequest, openDotaRetryAt                time.Time
}

type playerProfile struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Avatar   *string `json:"avatar"`
	RankTier *int    `json:"rankTier"`
	Source   string  `json:"source"`
}

type profileError struct {
	status    int
	message   string
	temporary bool
}

func (e *profileError) Error() string { return e.message }

func NewProfileHandler(token string) *ProfileHandler {
	return &ProfileHandler{
		token: strings.TrimSpace(token), gate: make(chan struct{}, 1),
		client:      &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		openDotaURL: "https://api.opendota.com/api/players", stratzURL: "https://api.stratz.com/graphql",
		openDotaTimeout: 6 * time.Second, stratzTimeout: 8 * time.Second, minInterval: 1100 * time.Millisecond,
	}
}

func (h *ProfileHandler) GetProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	account, err := strconv.ParseUint(id, 10, 32)
	if err != nil || account == 0 || strconv.FormatUint(account, 10) != id {
		WriteError(w, 400, "invalid_account_id", "Dota ID должен быть положительным 32-битным целым числом")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if profileContextDone(w, r, ctx) {
		return
	}
	select {
	case h.gate <- struct{}{}:
		defer func() { <-h.gate }()
	case <-ctx.Done():
		profileContextDone(w, r, ctx)
		return
	}
	if delay := h.minInterval - time.Since(h.lastRequest); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			profileContextDone(w, r, ctx)
			return
		}
	}
	if profileContextDone(w, r, ctx) {
		return
	}
	h.lastRequest = time.Now()
	var profile playerProfile
	var failure error
	if h.token == "" || !time.Now().Before(h.openDotaRetryAt) {
		profile, failure = h.openDota(ctx, id)
		if failure == nil {
			h.openDotaRetryAt = time.Time{}
		} else {
			if profileContextDone(w, r, ctx) {
				return
			}
			var upstream *profileError
			if !errors.As(failure, &upstream) || !upstream.temporary {
				WriteError(w, upstreamStatus(failure), "profile_unavailable", failure.Error())
				return
			}
			if h.token == "" {
				WriteError(w, 503, "profile_fallback_not_configured", "OpenDota недоступна. Резерв STRATZ не настроен на сервере.")
				return
			}
			h.openDotaRetryAt = time.Now().Add(time.Minute)
		}
	} else {
		failure = errors.New("primary cooling down")
	}
	if failure != nil {
		profile, failure = h.stratz(ctx, id, account)
		if profileContextDone(w, r, ctx) {
			return
		}
		if failure != nil {
			WriteError(w, upstreamStatus(failure), "profile_unavailable", failure.Error())
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func profileContextDone(w http.ResponseWriter, r *http.Request, ctx context.Context) bool {
	if ctx.Err() == nil {
		return false
	}
	if r.Context().Err() == nil {
		WriteError(w, http.StatusGatewayTimeout, "profile_timeout", "Сервис профилей не ответил вовремя. Повторите запрос позже.")
	}
	return true
}

func upstreamStatus(err error) int {
	var failure *profileError
	if errors.As(err, &failure) {
		return failure.status
	}
	return http.StatusBadGateway
}

func temporaryProfileError(provider string) *profileError {
	return &profileError{status: 502, message: provider + " не вернула профиль. Повторите запрос позже.", temporary: true}
}

func (h *ProfileHandler) request(ctx context.Context, endpoint, method string, body []byte, timeout time.Duration, auth bool, out any) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	if auth {
		request.Header.Set("Authorization", "Bearer "+h.token)
		request.Header.Set("User-Agent", "STRATZ_API")
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := h.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, fmt.Errorf("upstream HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return 200, errors.New("invalid provider body")
	}
	if err = json.Unmarshal(data, out); err != nil {
		return 200, errors.New("invalid provider JSON")
	}
	return 200, nil
}

func (h *ProfileHandler) openDota(ctx context.Context, id string) (playerProfile, error) {
	var payload struct {
		Profile *struct {
			AccountID    uint64 `json:"account_id"`
			Name         string `json:"personaname"`
			Avatar       string `json:"avatarfull"`
			MediumAvatar string `json:"avatarmedium"`
		} `json:"profile"`
		Rank *int `json:"rank_tier"`
	}
	status, err := h.request(ctx, h.openDotaURL+"/"+id, http.MethodGet, nil, h.openDotaTimeout, false, &payload)
	if status == 404 {
		return playerProfile{}, &profileError{status: 404, message: "Профиль не найден в OpenDota. Проверьте Dota ID."}
	}
	if err != nil {
		failure := temporaryProfileError("OpenDota")
		failure.temporary = status == 0 || status == 200 || status == 429 || status >= 500
		return playerProfile{}, failure
	}
	if payload.Profile == nil || strconv.FormatUint(payload.Profile.AccountID, 10) != id {
		return playerProfile{}, temporaryProfileError("OpenDota")
	}
	avatar := payload.Profile.Avatar
	if avatar == "" {
		avatar = payload.Profile.MediumAvatar
	}
	return normalizeProfile(id, payload.Profile.Name, avatar, payload.Rank, "opendota"), nil
}

func (h *ProfileHandler) stratz(ctx context.Context, id string, account uint64) (playerProfile, error) {
	body, _ := json.Marshal(map[string]any{
		"query":     `query Profile($id: Long!) { player(steamAccountId: $id) { steamAccount { id name avatar seasonRank } } }`,
		"variables": map[string]uint64{"id": account},
	})
	var payload struct {
		Data *struct {
			Player *struct {
				Account *struct {
					ID     uint64 `json:"id"`
					Name   string `json:"name"`
					Avatar string `json:"avatar"`
					Rank   *int   `json:"seasonRank"`
				} `json:"steamAccount"`
			} `json:"player"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	status, err := h.request(ctx, h.stratzURL, http.MethodPost, body, h.stratzTimeout, true, &payload)
	if status == 401 || status == 403 {
		return playerProfile{}, &profileError{status: 502, message: "STRATZ отклонила доступ. Проверьте токен и доступ сервера к STRATZ."}
	}
	if err != nil || len(payload.Errors) > 0 || payload.Data == nil || payload.Data.Player == nil || payload.Data.Player.Account == nil {
		return playerProfile{}, temporaryProfileError("STRATZ (резерв после сбоя OpenDota)")
	}
	player := payload.Data.Player.Account
	if strconv.FormatUint(player.ID, 10) != id {
		return playerProfile{}, temporaryProfileError("STRATZ")
	}
	return normalizeProfile(id, player.Name, player.Avatar, player.Rank, "stratz"), nil
}

func normalizeProfile(id, name, avatar string, rank *int, source string) playerProfile {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Игрок " + id
	}
	if runes := []rune(name); len(runes) > 120 {
		name = string(runes[:120])
	}
	var safeAvatar *string
	if parsed, err := url.Parse(avatar); err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil {
		safeAvatar = &avatar
	}
	if rank != nil && (*rank != 80 && (*rank/10 < 1 || *rank/10 > 7 || *rank%10 < 1 || *rank%10 > 5)) {
		rank = nil
	}
	return playerProfile{ID: id, Name: name, Avatar: safeAvatar, RankTier: rank, Source: source}
}
