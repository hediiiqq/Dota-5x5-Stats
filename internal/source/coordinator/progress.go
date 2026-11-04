package coordinator

import (
	"context"
	"errors"
	"fmt"
)

type Event struct {
	Level, Stage, Message string
	MatchID               uint64
}

// Progress reports stage changes and counter increments during GC requests.
type Progress struct {
	Stage                                  string
	Discovered, Existing, Filtered, Failed int64
	Event                                  *Event
}

func detailsFailureProgress(matchID uint64, err error) Progress {
	message := "Не удалось загрузить подробности матча. Подробности ошибки — в техническом журнале исполнителя."
	var response *MatchDetailsError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		message = "Не удалось загрузить подробности матча: истекло время ожидания."
	case errors.Is(err, context.Canceled):
		message = "Загрузка подробностей матча отменена."
	case errors.As(err, &response):
		message = fmt.Sprintf("Координатор Dota 2 не вернул подробности матча; код результата: %d.", response.Result)
	}
	return Progress{Failed: 1, Event: &Event{Level: "error", Stage: "details", MatchID: matchID, Message: message}}
}

func reportProgress(ctx context.Context, p Progress, observers []func(context.Context, Progress) error) error {
	for _, observer := range observers {
		if err := observer(ctx, p); err != nil {
			return err
		}
	}
	return nil
}
