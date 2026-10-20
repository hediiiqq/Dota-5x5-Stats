package handlers

import (
	"context"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MatchHandler struct {
	DB *pgxpool.Pool
}

func (h *MatchHandler) GetMatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	matchID, err := strconv.ParseInt(id, 10, 64)
	if err != nil || matchID <= 0 {
		WriteError(w, http.StatusBadRequest,
			"invalid_match_id", "ID должен быть положительным целым числом")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	internalId, data, err := postgres.GetMatch(ctx, h.DB, matchID)

	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, http.StatusNotFound,
			"match_not_found", "Матч не найден")
		return
	}

	if err != nil {
		log.Printf("Не удалось получить матч с внутренним ID %d из БД: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}

	var source coordinator.GCMatch

	err = json.Unmarshal(data, &source)

	if err != nil {
		log.Printf("Не удалось разобрать сохранённый JSON матча с внутренним ID %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}

	response := dto.ToMatchResponse(internalId, source)

	w.Header().Set("Content-Type", "application/json")
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		log.Printf("Не удалось записать JSON-ответ с матчем с внутренним ID %d: %v", matchID, err)
		return
	}
}

func (h *MatchHandler) ListMatches(w http.ResponseWriter, r *http.Request) {

	limit1 := r.URL.Query().Get("limit")
	if limit1 == "" {
		limit1 = "20"
	}

	limit, err := strconv.Atoi(limit1)

	if err != nil {
		WriteError(w, http.StatusBadRequest,
			"invalid_limit", "limit должен быть целым числом от 1 до 100")
		return
	}

	if limit > 100 || limit < 1 {
		WriteError(w, http.StatusBadRequest,
			"invalid_limit", "limit должен быть целым числом от 1 до 100")
		return
	}

	offset1 := r.URL.Query().Get("offset")
	if offset1 == "" {
		offset1 = "0"
	}

	offset, err := strconv.Atoi(offset1)

	if err != nil {
		WriteError(w, http.StatusBadRequest,
			"invalid_offset", "offset должен быть неотрицательным целым числом")
		return

	}

	if offset < 0 {
		WriteError(w, http.StatusBadRequest,
			"invalid_offset", "offset должен быть неотрицательным целым числом")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	data, err := postgres.ListMatches(ctx, h.DB, limit, offset)

	if err != nil {
		log.Printf("Не удалось получить список матчей из БД (limit=%d, offset=%d): %v", limit, offset, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить список матчей")
		return

	}

	response := make([]dto.MatchResponse, 0, len(data))

	for _, match := range data {
		gcMatch := coordinator.GCMatch{}

		err = json.Unmarshal(match.RawData, &gcMatch)

		if err != nil {
			log.Printf("Не удалось разобрать сохранённый JSON матча с внутренним ID %d при формировании списка: %v", match.ID, err)
			WriteError(w, http.StatusInternalServerError,
				"internal_error", "Не удалось получить список матчей")
			return
		}

		matchResponse := dto.ToMatchResponse(match.ID, gcMatch)
		response = append(response, matchResponse)

	}
	w.Header().Set("Content-Type", "application/json")
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		log.Printf("Не удалось записать JSON-ответ со списком матчей (limit=%d, offset=%d): %v", limit, offset, err)
		return
	}

}

func (h *MatchHandler) Health(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Content-Type", "application/json")
	_, err := fmt.Fprint(w, `{"status":"ok"}`)
	if err != nil {
		log.Printf("Не удалось вывести JSON ответ ошибка : %v", err)
		return
	}

}
