package handlers

import (
	"context"
	"dota-stats/internal/auth"
	"dota-stats/internal/config"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

func (h *AuthHandler) ListImportAccounts(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("cache-control", "no-store")

	_, _, err := h.SessionFromRequest(r)

	if errors.Is(err, auth.ErrUnauthenticated) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if errors.Is(err, auth.ErrAdminRequired) {
		WriteError(w, http.StatusForbidden, "admin_required", auth.ErrAdminRequired.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Ошибка получения сессии")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	accountsDb, err := postgres.ListImportAccounts(ctx, h.DB)
	if err != nil {
		log.Printf("ошибка ListImportAccounts, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить список аккаунтов")
		return
	}

	accounts := config.Load()

	accountsByID := make(map[string]*postgres.ImportAccount, len(accountsDb))

	for _, accountDb := range accountsDb {
		accountsByID[accountDb.Id] = accountDb
	}

	result := make([]dto.ImportAccount, 0, len(accounts))

	for _, account := range accounts {
		item := dto.ImportAccount{
			Id:              account.ID,
			Name:            account.Name,
			ConnectionState: "disconnected",
		}

		if accountDb := accountsByID[account.ID]; accountDb != nil {
			item.LastSuccessAt = accountDb.LastSuccessAt
			if accountDb.ActiveJobId != nil {
				id := strconv.FormatInt(*accountDb.ActiveJobId, 10)
				item.ActiveJobId = &id
			}
			if accountDb.ActiveStage != nil {
				switch *accountDb.ActiveStage {
				case "steam_connect", "gc_connect":
					item.ConnectionState = "connecting"
				case "awaiting_guard":
					item.ConnectionState = "awaiting_guard"
				case "history", "details":
					item.ConnectionState = "ready"
				}
			}
			if accountDb.DotaAccountId != nil {
				id := strconv.FormatUint(uint64(*accountDb.DotaAccountId), 10)
				item.DotaAccountId = &id
			}

			if accountDb.LastCheckedMatchId != nil {
				id := strconv.FormatUint(*accountDb.LastCheckedMatchId, 10)
				item.LastCheckedMatchId = &id
			}
		}

		result = append(result, item)
	}

	responce := dto.ImportAccountsResponse{Accounts: result}

	w.Header().Set("Content-Type", "application/json")

	err = json.NewEncoder(w).Encode(responce)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}
