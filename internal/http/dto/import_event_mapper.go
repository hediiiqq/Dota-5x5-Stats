package dto

import (
	"dota-stats/internal/repository/postgres"
	"strconv"
)

func MapImportEvent(event postgres.ImportEvent) ImportEvent {

	events := ImportEvent{
		Id:        strconv.FormatInt(event.Id, 10),
		CreatedAt: event.CreatedAt,
		JobId:     strconv.FormatInt(event.JobId, 10),
		Level:     event.Level,
		Stage:     event.Stage,
		Message:   event.Message,
	}

	if event.DotaMatchId != nil {
		dotaMatchId := strconv.FormatUint(*event.DotaMatchId, 10)
		events.DotaMatchId = &dotaMatchId
	}

	return events

}
