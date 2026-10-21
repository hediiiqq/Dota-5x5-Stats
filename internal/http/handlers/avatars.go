package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const steamIndividualBase uint64 = 76561197960265728

type avatarEntry struct {
	url     string
	expires time.Time
}

// AvatarHandler keeps optional Steam profile lookups separate from match data.
// The API key is used only by the server and is never included in responses.
type AvatarHandler struct {
	apiKey string
	client *http.Client
	mu     sync.Mutex
	cache  map[string]avatarEntry
}

func NewAvatarHandler(apiKey string) *AvatarHandler {
	return &AvatarHandler{
		apiKey: strings.TrimSpace(apiKey),
		client: &http.Client{
			Timeout: 5 * time.Second,
			// Never forward the API-key-bearing request to a redirected endpoint.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		cache: make(map[string]avatarEntry),
	}
}

func (h *AvatarHandler) GetAvatars(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Query().Get("account_ids"), ",")
	if len(parts) > 10 {
		WriteError(w, http.StatusBadRequest, "invalid_account_ids", "Допустимо от 1 до 10 Account ID")
		return
	}
	accountIDs := make(map[string]string, len(parts)) // SteamID64 -> Account ID
	for _, part := range parts {
		id, err := strconv.ParseUint(part, 10, 32)
		if err != nil || id == 0 || strconv.FormatUint(id, 10) != part {
			WriteError(w, http.StatusBadRequest, "invalid_account_ids", "Account ID должен быть положительным 32-битным целым числом")
			return
		}
		accountIDs[strconv.FormatUint(steamIndividualBase+id, 10)] = part
	}

	avatars := make(map[string]string)
	if h.apiKey != "" {
		missing := make(map[string]string)
		now := time.Now()
		h.mu.Lock()
		for steamID, accountID := range accountIDs {
			entry, ok := h.cache[accountID]
			if ok && now.Before(entry.expires) {
				if entry.url != "" {
					avatars[accountID] = entry.url
				}
			} else {
				missing[steamID] = accountID
			}
		}
		h.mu.Unlock()
		if len(missing) > 0 {
			fresh := h.fetchAvatars(r.Context(), missing)
			if r.Context().Err() != nil {
				return
			}
			h.mu.Lock()
			for _, accountID := range missing {
				// Bound memory even if many distinct public IDs are requested.
				if len(h.cache) >= 2048 {
					for key := range h.cache {
						delete(h.cache, key)
						break
					}
				}
				avatar := fresh[accountID]
				ttl := 6 * time.Hour
				if avatar == "" {
					ttl = time.Minute // Avoid repeating failed/missing profile lookups.
				} else {
					avatars[accountID] = avatar
				}
				h.cache[accountID] = avatarEntry{url: avatar, expires: time.Now().Add(ttl)}
			}
			h.mu.Unlock()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=60")
	// An unavailable avatar is deliberately omitted; the UI retains initials.
	err := json.NewEncoder(w).Encode(struct {
		Avatars map[string]string `json:"avatars"`
	}{Avatars: avatars})
	if err != nil {
		log.Printf("Не удалось записать JSON-ответ с аватарками: %v", err)
	}
}

func (h *AvatarHandler) fetchAvatars(ctx context.Context, accounts map[string]string) map[string]string {
	avatars := make(map[string]string)
	steamIDs := make([]string, 0, len(accounts))
	for steamID := range accounts {
		steamIDs = append(steamIDs, steamID)
	}
	query := url.Values{"key": {h.apiKey}, "steamids": {strings.Join(steamIDs, ",")}}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?"+query.Encode(), nil)
	if err != nil {
		return avatars
	}
	req.Header.Set("Accept", "application/json")
	response, err := h.client.Do(req)
	if err != nil {
		// Transport errors may contain the complete URL with the API key. Do not log them.
		return avatars
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return avatars
	}
	var data struct {
		Response struct {
			Players []struct {
				SteamID string `json:"steamid"`
				Avatar  string `json:"avatarmedium"`
			} `json:"players"`
		} `json:"response"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&data); err != nil {
		return avatars
	}
	for _, player := range data.Response.Players {
		accountID, requested := accounts[player.SteamID]
		avatarURL, err := url.Parse(player.Avatar)
		if !requested || err != nil || avatarURL.Scheme != "https" || avatarURL.Hostname() == "" || avatarURL.User != nil {
			continue
		}
		avatars[accountID] = avatarURL.String()
	}
	return avatars
}
