package importer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"time"

	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/metadata"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func progressStageEvent(stage string) *postgres.ImportEvent {
	message := map[string]string{
		"steam_connect":  "Подключение к Steam.",
		"awaiting_guard": "Ожидается подтверждение входа в приложении Steam.",
		"gc_connect":     "Вход в Steam выполнен; подключение к координатору Dota 2.",
		"history":        "Соединение с Dota 2 установлено; начат обход истории матчей.",
		"details":        "Начата загрузка подробностей подходящих матчей.",
		"saving":         "Начато сохранение матчей и загрузка метаданных.",
	}[stage]
	if message == "" {
		return nil
	}
	return &postgres.ImportEvent{Level: "info", Stage: &stage, Message: message}
}

func recordJobEvent(ctx context.Context, db *pgxpool.Pool, jobID int64, event postgres.ImportEvent) {
	event.JobId = jobID
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := postgres.CreateImportEvent(writeCtx, db, &event); err != nil {
		log.Printf("Задание %d: не удалось записать событие: %v", jobID, err)
	}
}

func recordJobProgress(ctx context.Context, db *pgxpool.Pool, jobID int64, p postgres.ImportProgress) error {
	updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := postgres.AddImportProgress(updateCtx, db, jobID, p); err != nil {
		return err
	}
	if event := progressStageEvent(p.Stage); event != nil {
		recordJobEvent(ctx, db, jobID, *event)
	}
	return nil
}

func recordMatchProblem(ctx context.Context, db *pgxpool.Pool, jobID int64, stage string, matchID uint64, message string) {
	event := postgres.ImportEvent{Level: "error", Stage: &stage, Message: message}
	if matchID != 0 {
		event.DotaMatchId = &matchID
	}
	recordJobEvent(ctx, db, jobID, event)
}

// Raw errors stay in the terminal. Only error categories and numeric source
// codes are safe to include in the journal exposed through the admin API.
func eventFailureReason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "Истекло время ожидания запроса."
	}
	if errors.Is(err, context.Canceled) {
		return "Запрос отменён."
	}
	var status *metadata.HTTPStatusError
	if errors.As(err, &status) {
		return fmt.Sprintf("Сервер метаданных ответил HTTP %d.", status.StatusCode)
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		return fmt.Sprintf("Ошибка PostgreSQL (код %s).", pgError.Code)
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		if networkError.Timeout() {
			return "Истекло время ожидания сетевого ответа."
		}
		return "Не удалось получить ответ по сети."
	}
	return "Подробности ошибки — в техническом журнале исполнителя."
}
