package dto

import "time"

type ImportAccount struct {
	Id                 string     `json:"id"`
	Name               string     `json:"name"`
	DotaAccountId      *string    `json:"dota_account_id"`
	ConnectionState    string     `json:"connection_state"`
	LastSuccessAt      *time.Time `json:"last_success_at"`
	LastCheckedMatchId *string    `json:"last_checked_match_id"`
	ActiveJobId        *string    `json:"active_job_id"`
}

type ImportAccountsResponse struct {
	Accounts []ImportAccount `json:"accounts"`
}
