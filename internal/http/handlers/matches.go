package handlers

import (
	"context"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"encoding/json"
	"errors"
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
	matchID, err := strconv.ParseUint(id, 10, 64)
	if err != nil || matchID == 0 {
		http.Error(w, "Некорректный ID матча", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	internalId, data, err := postgres.GetMatch(ctx, h.DB, matchID)

	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Матч не найден", http.StatusNotFound)
		return
	}

	if err != nil {
		http.Error(w, "Не удалось получить матч", http.StatusInternalServerError)
		return
	}

	var source coordinator.GCMatch

	err = json.Unmarshal(data, &source)

	if err != nil {
		http.Error(w, "ошибка чтения json", http.StatusInternalServerError)
		return
	}

	response := dto.ToMatchResponse(internalId, source)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *MatchHandler) ListMatches(w http.ResponseWriter, r *http.Request) {

	limit1 := r.URL.Query().Get("limit")
	if limit1 == "" {
		limit1 = "20"
	}

	limit, err := strconv.Atoi(limit1)

	if err != nil {
		http.Error(w, "Некорректный limit", http.StatusBadRequest)
		return
	}

	if limit > 100 || limit < 1 {
		http.Error(w, "Некорректный limit", http.StatusBadRequest)
		return
	}

	offset1 := r.URL.Query().Get("offset")
	if offset1 == "" {
		offset1 = "0"
	}

	offset, err := strconv.Atoi(offset1)

	if err != nil {
		http.Error(w, "Некорректный offset", http.StatusBadRequest)
		return
	}

	if offset < 0 {
		http.Error(w, "Некорректный offset", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	data, err := postgres.ListMatches(ctx, h.DB, limit, offset)

	if err != nil {
		http.Error(w, "Матчи не найдены", http.StatusInternalServerError)
		return
	}

	response := make([]dto.MatchResponse, 0, len(data))

	for _, match := range data {
		gcMatch := coordinator.GCMatch{}

		err = json.Unmarshal(match.RawData, &gcMatch)

		if err != nil {
			http.Error(w, "ошибка чтения json", http.StatusInternalServerError)
			return
		}

		matchResponse := dto.ToMatchResponse(match.ID, gcMatch)
		response = append(response, matchResponse)

	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)

}
