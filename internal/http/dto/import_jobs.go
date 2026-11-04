package dto

import (
	"time"
)

type ImportJobCounters struct {
	Discovered int64 `json:"discovered"`
	Saved      int64 `json:"saved"`
	Existing   int64 `json:"existing"`
	Filtered   int64 `json:"filtered"`
	Failed     int64 `json:"failed"`
}

type ImportJobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type ImportJob struct {
	Id           string            `json:"id"`
	AccountId    string            `json:"account_id"`
	AccountName  string            `json:"account_name"`
	Mode         string            `json:"mode"`
	MinMatchId   *string           `json:"min_match_id"`
	AfterMatchId *string           `json:"after_match_id"`
	Status       string            `json:"status"`
	Stage        *string           `json:"stage"`
	CreatedAt    time.Time         `json:"created_at"`
	StartedAt    *time.Time        `json:"started_at"`
	FinishedAt   *time.Time        `json:"finished_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
	Counters     ImportJobCounters `json:"counters"`
	Error        *ImportJobError   `json:"error"`
}

type ImportJobResponse struct {
	Job ImportJob `json:"job"`
}

type ImportJobsResponse struct {
	Jobs       []ImportJob `json:"jobs"`
	NextBefore *string     `json:"next_before"`
}

type CreateImportJobRequest struct {
	AccountId  string  `json:"account_id"`
	Mode       string  `json:"mode"`
	MinMatchId *string `json:"min_match_id"`
}
