package handlers

import (
	"context"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/paralin/go-dota2/protocol"
)

// Decode separately from I/O so missing, corrupt and mismatched data are tested
// without requiring a production database.
func graphsFromJSON(id int, matchData, metadata []byte) (dto.GraphsResponse, error) {
	var match protocol.CMsgDOTAMatch
	if err := json.Unmarshal(matchData, &match); err != nil {
		return dto.GraphsResponse{}, fmt.Errorf("основной матч: %w", err)
	}
	if match.GetMatchId() == 0 || match.GetDuration() == 0 || match.GetDuration() > math.MaxInt32 {
		return dto.GraphsResponse{}, errors.New("некорректный ID или длительность основного матча")
	}
	if len(metadata) == 0 {
		return dto.GraphsResponse{MatchID: strconv.Itoa(id), DotaMatchID: strconv.FormatUint(match.GetMatchId(), 10), Duration: match.GetDuration(),
			Teams: []dto.TeamGraphs{}, Players: []dto.PlayerGraphs{}, PreliminarySeries: []string{}}, nil
	}
	var source protocol.CDOTAMatchMetadataFile
	if err := json.Unmarshal(metadata, &source); err != nil {
		return dto.GraphsResponse{}, fmt.Errorf("метаданные: %w", err)
	}
	if source.GetMatchId() != match.GetMatchId() {
		return dto.GraphsResponse{}, errors.New("ID основного матча и метаданных не совпадают")
	}
	return dto.ToGraphResponse(id, source, match.GetDuration())
}

func (h *MatchHandler) GetGraphs(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		WriteError(w, 400, "invalid_match_id", "ID должен быть положительным целым числом")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	internalID, matchData, err := postgres.GetMatch(ctx, h.DB, id)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "match_not_found", "Матч не найден")
		return
	}
	if err != nil {
		log.Printf("Графики: чтение матча %d: %v", id, err)
		WriteError(w, 500, "internal_error", "Не удалось получить матч")
		return
	}
	metadata, err := postgres.GetMetadata(ctx, h.DB, id)
	if err != nil {
		log.Printf("Графики: чтение метаданных %d: %v", id, err)
		WriteError(w, 500, "internal_error", "Не удалось получить метаданные")
		return
	}
	response, err := graphsFromJSON(internalID, matchData, metadata)
	if err != nil {
		log.Printf("Графики: преобразование матча %d: %v", id, err)
		WriteError(w, 500, "internal_error", "Сохранённые данные матча некорректны")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Графики: запись ответа для матча %d: %v", id, err)
	}
}
