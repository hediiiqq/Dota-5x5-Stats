package dto

import "time"

type ImportEvent struct {
	Id          string    `json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	JobId       string    `json:"job_id"`
	Level       string    `json:"level"`
	Stage       *string   `json:"stage"`
	DotaMatchId *string   `json:"dota_match_id"`
	Message     string    `json:"message"`
}

type ImportEventsResponse struct {
	Events     []ImportEvent `json:"events"`
	NextBefore *string       `json:"next_before"`
}
