package handlers

import (
	"context"
	"dota-stats/internal/auth"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

func (h *AuthHandler) ListImportEvents(w http.ResponseWriter, r *http.Request) {

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

	limit := 20

	if r.URL.Query().Get("limit") != "" {
		limit, err = strconv.Atoi(r.URL.Query().Get("limit"))
		if err != nil {
			WriteError(w, http.StatusBadRequest, "invalid_request", "не получилось получить лимит")
			return
		}
		if limit > 100 || limit < 1 {
			WriteError(w, http.StatusBadRequest, "invalid_request", "limit должен быть целым числом от 1 до 100")
			return
		}
	}

	var beforeID *int64

	if r.URL.Query().Get("before") != "" {
		parsedID, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "invalid_request", "не получилось получить beforeID")
			return
		}
		if parsedID < 1 {
			WriteError(w, http.StatusBadRequest, "invalid_request", "before должен быть положительным целым числом")
			return
		}
		beforeID = &parsedID
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	events, err := postgres.ListImportEvents(ctx, h.DB, int64(limit+1), beforeID)
	if err != nil {
		log.Printf("ошибка ListImportEvents, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить события")
		return
	}

	var nextBefore *string = nil

	if len(events) > limit {
		events = events[:limit]

		lastEvent := events[len(events)-1]
		cursor := strconv.FormatInt(lastEvent.Id, 10)
		nextBefore = &cursor
	}

	eventDTO := make([]dto.ImportEvent, 0, len(events))
	for _, event := range events {
		eventDTO = append(eventDTO, dto.MapImportEvent(*event))
	}

	response := dto.ImportEventsResponse{
		Events:     eventDTO,
		NextBefore: nextBefore,
	}

	w.Header().Set("content-type", "application/json")
	err = json.NewEncoder(w).Encode(response)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}
