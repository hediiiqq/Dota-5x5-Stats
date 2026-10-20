package handlers

import (
	"context"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"encoding/json"
	"errors"
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
		apiError := dto.APIError{Code: "invalid_match_id", Message: "ID должен быть положительным целым числом"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ о некорректном ID матча %q: %v", id, encodeErr)
		}

		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	internalId, data, err := postgres.GetMatch(ctx, h.DB, matchID)

	if errors.Is(err, pgx.ErrNoRows) {
		apiError := dto.APIError{Code: "match_not_found", Message: "Матч не найден"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ об отсутствии матча с внутренним ID %d: %v", matchID, encodeErr)
		}
		return
	}

	if err != nil {
		log.Printf("Не удалось получить матч с внутренним ID %d из БД: %v", matchID, err)
		apiError := dto.APIError{Code: "internal_error", Message: "Не удалось получить матч"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ об ошибке получения матча с внутренним ID %d: %v", matchID, encodeErr)
		}
		return
	}

	var source coordinator.GCMatch

	err = json.Unmarshal(data, &source)

	if err != nil {
		log.Printf("Не удалось разобрать сохранённый JSON матча с внутренним ID %d: %v", matchID, err)
		apiError := dto.APIError{Code: "internal_error", Message: "Не удалось получить матч"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ об ошибке обработки матча с внутренним ID %d: %v", matchID, encodeErr)
		}
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
		apiError := dto.APIError{Code: "invalid_limit", Message: "limit должен быть целым числом от 1 до 100"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ о некорректном limit %q: %v", limit1, encodeErr)
		}
		return
	}

	if limit > 100 || limit < 1 {
		apiError := dto.APIError{Code: "invalid_limit", Message: "limit должен быть целым числом от 1 до 100"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ о недопустимом limit %d: %v", limit, encodeErr)
		}
		return
	}

	offset1 := r.URL.Query().Get("offset")
	if offset1 == "" {
		offset1 = "0"
	}

	offset, err := strconv.Atoi(offset1)

	if err != nil {
		apiError := dto.APIError{Code: "invalid_offset", Message: "offset должен быть неотрицательным целым числом"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ о некорректном offset %q: %v", offset1, encodeErr)
		}
		return

	}

	if offset < 0 {
		apiError := dto.APIError{Code: "invalid_offset", Message: "offset должен быть неотрицательным целым числом"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ о недопустимом offset %d: %v", offset, encodeErr)
		}
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	data, err := postgres.ListMatches(ctx, h.DB, limit, offset)

	if err != nil {
		log.Printf("Не удалось получить список матчей из БД (limit=%d, offset=%d): %v", limit, offset, err)
		apiError := dto.APIError{Code: "internal_error", Message: "Не удалось получить список матчей"}
		errorResponse := dto.ErrorResponse{Error: apiError}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeErr := json.NewEncoder(w).Encode(errorResponse)
		if encodeErr != nil {
			log.Printf("Не удалось записать JSON-ответ об ошибке получения списка матчей: %v", encodeErr)
		}
		return

	}

	response := make([]dto.MatchResponse, 0, len(data))

	for _, match := range data {
		gcMatch := coordinator.GCMatch{}

		err = json.Unmarshal(match.RawData, &gcMatch)

		if err != nil {
			log.Printf("Не удалось разобрать сохранённый JSON матча с внутренним ID %d при формировании списка: %v", match.ID, err)
			apiError := dto.APIError{Code: "internal_error", Message: "Не удалось получить список матчей"}
			errorResponse := dto.ErrorResponse{Error: apiError}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			encodeErr := json.NewEncoder(w).Encode(errorResponse)
			if encodeErr != nil {
				log.Printf("Не удалось записать JSON-ответ об ошибке обработки списка матчей: %v", encodeErr)
			}

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
