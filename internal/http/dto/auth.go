package dto

import "time"

type AdminIdentity struct {
	SteamID string `json:"steam_id"`
}

type AdminSessionResponse struct {
	Admin     AdminIdentity `json:"admin"`
	ExpiresAt time.Time     `json:"expires_at"`
	CSRFToken string        `json:"csrf_token"`
}
