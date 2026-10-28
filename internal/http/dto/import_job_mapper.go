package dto

import (
	"dota-stats/internal/repository/postgres"
	"strconv"
)

func MapImportJob(job postgres.ImportJob) ImportJob {

	jobs := ImportJob{
		Id:          strconv.FormatInt(job.Id, 10),
		AccountId:   job.AccountId,
		AccountName: job.AccountName,
		Mode:        job.Mode,
		Status:      job.Status,
		Stage:       job.Stage,
		CreatedAt:   job.CreatedAt,
		StartedAt:   job.StartedAt,
		FinishedAt:  job.FinishedAt,
		UpdatedAt:   job.UpdatedAt,
		Counters:    ImportJobCounters{Discovered: job.Discovered, Saved: job.Saved, Existing: job.Existing, Filtered: job.Filtered, Failed: job.Failed},
	}

	if job.MinMatchId != nil {
		minMatchId := strconv.FormatUint(*job.MinMatchId, 10)
		jobs.MinMatchId = &minMatchId
	}

	if job.AfterMatchId != nil {
		afterMatchId := strconv.FormatUint(*job.AfterMatchId, 10)
		jobs.AfterMatchId = &afterMatchId
	}

	if job.ErrorCode != nil || job.ErrorMessage != nil {
		errorJob := ImportJobError{}
		if job.ErrorCode != nil {
			errorJob.Code = *job.ErrorCode
		}
		if job.ErrorMessage != nil {
			errorJob.Message = *job.ErrorMessage
		}
		jobs.Error = &errorJob
	}

	return jobs
}
