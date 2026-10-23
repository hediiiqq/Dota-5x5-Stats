package handlers

import (
	"context"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/paralin/go-dota2/protocol"
)

func (h *MatchHandler) GetMetadata(w http.ResponseWriter, r *http.Request) {

	id := r.PathValue("id")
	matchID, err := strconv.ParseInt(id, 10, 64)

	if err != nil || matchID <= 0 {
		WriteError(w, http.StatusBadRequest,
			"invalid_match_id", "ID должен быть положительным целым числом")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	internalId, matchData, err := postgres.GetMatch(ctx, h.DB, matchID)

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

	data, err := postgres.GetMetadata(ctx, h.DB, matchID)

	if err != nil {
		log.Printf("Ошибка чтения метаданных матча %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить метаданные")
		return
	}

	if len(data) == 0 {
		var match protocol.CMsgDOTAMatch
		if err := json.Unmarshal(matchData, &match); err != nil {
			log.Printf("Ошибка разбора матча %d: %v", matchID, err)
			WriteError(w, http.StatusInternalServerError,
				"internal_error", "Не удалось получить матч")
			return
		}
		response := dto.PurchasesResponse{
			MatchId:     strconv.Itoa(internalId),
			DotaMatchId: strconv.FormatUint(match.GetMatchId(), 10),
			Available:   false,
			Players:     make([]dto.PlayerPurchase, 0),
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("Ошибка отправки ответа для матча %d: %v", matchID, err)
		}
		return
	}

	var source protocol.CDOTAMatchMetadataFile

	err = json.Unmarshal(data, &source)

	if err != nil {
		log.Printf("Не удалось разобрать сохранённый JSON матча с внутренним ID %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}
	if source.GetMetadata() == nil {
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Сохранённые метаданные матча некорректны")
		return
	}

	response := dto.ToMetaResponse(internalId, source)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Ошибка отправки покупок для матча %d: %v", matchID, err)
	}
}
