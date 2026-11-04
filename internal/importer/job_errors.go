package importer

import (
	"context"
	"errors"
	"fmt"
)

// Only explicitly constructed messages are exposed through the admin API.
// Steam, database and HTTP errors may contain credentials or connection URLs.
type partialImportError struct {
	historyIncomplete  bool
	failedDetails      int64
	failedProcessing   int64
	firstFailedMatchID uint64
}

func (e *partialImportError) Error() string {
	message := "Импорт выполнен частично; сохранённые матчи оставлены в базе, прогресс синхронизации не обновлён."
	if e.historyIncomplete {
		message += " Не удалось достичь нижней границы истории."
	}
	if e.failedDetails > 0 {
		message += fmt.Sprintf(" Не загружены подробности %d матчей", e.failedDetails)
		if e.firstFailedMatchID != 0 {
			message += fmt.Sprintf("; первый Dota Match ID: %d", e.firstFailedMatchID)
		}
		message += "."
	}
	if e.failedProcessing > 0 {
		message += fmt.Sprintf(" Ошибки обработки или метаданных: %d.", e.failedProcessing)
	}
	return message
}

func publicJobError(err error) (string, string) {
	var partial *partialImportError
	if errors.As(err, &partial) {
		return "import_partial", partial.Error()
	}
	if errors.Is(err, context.Canceled) {
		return "import_canceled", "Импорт остановлен; сохранённые результаты оставлены в базе."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "import_timeout", "Истекло время ожидания импорта. Подробности в журнале исполнителя."
	}
	return "import_failed", "Не удалось завершить импорт. Подробности в журнале исполнителя."
}
