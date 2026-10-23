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

func (h *MatchHandler) GetInventory(w http.ResponseWriter, r *http.Request) {

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
		log.Printf("Инвентарь: не удалось прочитать основной матч из БД; внутренний ID %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}

	data, err := postgres.GetMetadata(ctx, h.DB, matchID)

	if err != nil {
		log.Printf("Инвентарь: не удалось прочитать метаданные из БД; внутренний ID матча %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить метаданные")
		return
	}

	var match protocol.CMsgDOTAMatch
	if err := json.Unmarshal(matchData, &match); err != nil {
		log.Printf("Инвентарь: не удалось разобрать JSON основного матча; внутренний ID %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}

	if match.GetMatchId() == 0 {
		log.Printf("Инвентарь: в основном матче отсутствует Dota match ID или он равен нулю; внутренний ID матча %d", matchID)
		WriteError(w, http.StatusInternalServerError, "empty_match_id", "пустой матч айди")
		return
	}

	if len(data) == 0 {

		response := dto.InventoryResponse{
			MatchID:     strconv.Itoa(internalId),
			DotaMatchID: strconv.FormatUint(match.GetMatchId(), 10),
			Available:   false,
			Players:     make([]dto.PlayerInventory, 0),
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("Инвентарь: не удалось записать JSON-ответ об отсутствии метаданных; внутренний ID матча %d: %v", matchID, err)
		}
		return
	}
	var source protocol.CDOTAMatchMetadataFile

	err = json.Unmarshal(data, &source)

	if err != nil {
		log.Printf("Инвентарь: не удалось разобрать JSON сохранённых метаданных; внутренний ID матча %d: %v", matchID, err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить матч")
		return
	}

	if source.GetMetadata() == nil {
		log.Printf("Инвентарь: в сохранённых метаданных отсутствует публичная часть; внутренний ID матча %d", matchID)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Сохранённые метаданные матча некорректны")
		return
	}

	if source.GetMatchId() == 0 {
		log.Printf("Инвентарь: в сохранённых метаданных отсутствует Dota match ID или он равен нулю; внутренний ID матча %d", matchID)
		WriteError(w, http.StatusInternalServerError, "empty_match_id", "пустой матч айди")
		return
	}

	if match.GetMatchId() != source.GetMatchId() {
		log.Printf("Инвентарь: Dota match ID метаданных не совпадает с основным матчем; внутренний ID %d, Dota ID основного матча %d, Dota ID метаданных %d", matchID, match.GetMatchId(), source.GetMatchId())
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Сохранённые метаданные матча некорректны")
		return
	}

	response, err := dto.ToInventoryResponse(internalId, source, match.GetDuration())

	if err != nil {
		log.Printf("Инвентарь: не удалось преобразовать метаданные в ответ API; внутренний ID матча %d, Dota match ID %d: %v", matchID, match.GetMatchId(), err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Сохранённые метаданные матча некорректны")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Инвентарь: не удалось записать JSON-ответ со снимками; внутренний ID матча %d: %v", matchID, err)
	}
}
