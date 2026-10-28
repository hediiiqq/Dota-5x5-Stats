package handlers

import (
	"context"
	"dota-stats/internal/auth"
	"dota-stats/internal/config"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func (h *AuthHandler) GetImportJob(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("cache-control", "no-store")

	_, _, err := h.SessionFromRequest(r)

	if errors.Is(err, auth.ErrUnauthenticated) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if errors.Is(err, auth.ErrAdminRequired) {
		WriteError(w, http.StatusForbidden, "admin_required", auth.ErrAdminRequired.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Ошибка получения сессии")
		return
	}

	idStr := r.PathValue("id")

	id, err := strconv.ParseInt(idStr, 10, 64)

	if err != nil || id <= 0 {
		WriteError(w, http.StatusBadRequest,
			"invalid_request", "ID должен быть положительным целым числом")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	job, found, err := postgres.GetImportJob(ctx, h.DB, id)
	if err != nil {
		log.Printf("ошибка GetImportJob, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить задание")
		return
	}

	if !found {
		WriteError(w, http.StatusNotFound, "job_not_found", "задача не найдена")
		return
	}

	jobDTO := dto.MapImportJob(*job)

	response := dto.ImportJobResponse{Job: jobDTO}

	w.Header().Set("content-type", "application/json")

	err = json.NewEncoder(w).Encode(response)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}

func (h *AuthHandler) ListImportJobs(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("cache-control", "no-store")

	_, _, err := h.SessionFromRequest(r)

	if errors.Is(err, auth.ErrUnauthenticated) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if errors.Is(err, auth.ErrAdminRequired) {
		WriteError(w, http.StatusForbidden, "admin_required", auth.ErrAdminRequired.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Ошибка получения сессии")
		return
	}

	limit := 20

	if r.URL.Query().Get("limit") != "" {
		limit, err = strconv.Atoi(r.URL.Query().Get("limit"))
		if err != nil {
			WriteError(w, http.StatusBadRequest, "invalid_request", "не получилось получить лимит")
			return
		}
		if limit > 100 || limit < 1 {
			WriteError(w, http.StatusBadRequest, "invalid_request", "limit должен быть целым числом от 1 до 100")
			return
		}
	}

	var beforeID *int64

	if r.URL.Query().Get("before") != "" {
		parsedID, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "invalid_request", "не получилось получить beforeID")
			return
		}
		if parsedID < 1 {
			WriteError(w, http.StatusBadRequest, "invalid_request", "before должен быть целым числом от 1 до 100")
			return
		}
		beforeID = &parsedID
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	jobs, err := postgres.ListImportJobs(ctx, h.DB, limit+1, beforeID)
	if err != nil {

		log.Printf("ошибка ListImportJobs, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить задания")
		return

	}

	var nextBefore *string = nil

	if len(jobs) > limit {
		jobs = jobs[:limit]

		lastJob := jobs[len(jobs)-1]
		cursor := strconv.FormatInt(lastJob.Id, 10)
		nextBefore = &cursor
	}

	jobsDTO := make([]dto.ImportJob, 0, len(jobs))
	for _, job := range jobs {
		jobsDTO = append(jobsDTO, dto.MapImportJob(*job))
	}

	response := dto.ImportJobsResponse{
		Jobs:       jobsDTO,
		NextBefore: nextBefore,
	}
	w.Header().Set("content-type", "application/json")
	err = json.NewEncoder(w).Encode(response)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}

func (h *AuthHandler) CreateImportJob(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("cache-control", "no-store")

	_, _, err := h.SessionFromRequest(r)

	if errors.Is(err, auth.ErrUnauthenticated) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if errors.Is(err, auth.ErrAdminRequired) {
		WriteError(w, http.StatusForbidden, "admin_required", auth.ErrAdminRequired.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Ошибка получения сессии")
		return
	}

	checkCSRF := h.CheckCSRF(r)

	if !checkCSRF {
		WriteError(w, http.StatusForbidden, "csrf_invalid", "Проверка CSRF не пройдена")
		return
	}

	head := r.Header.Get("Content-Type")

	mediaType, _, err := mime.ParseMediaType(head)

	if err != nil {
		WriteError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "не поддерживаемый заголовок")
		return
	}

	if mediaType != "application/json" {
		WriteError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "не поддерживаемый заголовок")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)

	body := dto.CreateImportJobRequest{}

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	err = decoder.Decode(&body)

	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		WriteError(w, http.StatusRequestEntityTooLarge,
			"request_too_large", "Слишком большой запрос")
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Некорректный JSON")
		return
	}

	var extra any
	err = decoder.Decode(&extra)
	if errors.As(err, &maxBytesErr) {
		WriteError(w, http.StatusRequestEntityTooLarge,
			"request_too_large", "Слишком большой запрос")
		return
	}
	if !errors.Is(err, io.EOF) {
		WriteError(w, http.StatusBadRequest,
			"invalid_request", "Ожидается один JSON-объект")
		return
	}

	if body.Mode != "history" && body.Mode != "incremental" {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Допустимы history и incremental")
		return
	}

	if body.Mode == "history" && body.MinMatchId == nil {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Для history требуется min_match_id")
		return
	}

	if body.Mode == "incremental" && body.MinMatchId != nil {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Для incremental поле min_match_id не допускается")
		return
	}

	var minMatchID *uint64 = nil

	if body.Mode == "history" {
		parsedID, err := strconv.ParseUint(*body.MinMatchId, 10, 63)
		if err != nil || parsedID == 0 {
			WriteError(w, http.StatusBadRequest, "invalid_request", "min_match_id должен быть положительным целым числом в диапазоне bigint")
			return
		}
		minMatchID = &parsedID

	}

	if body.AccountId == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request", "accountId пустой")
		return
	}

	accounts := config.Load()
	var selectedAccount config.SteamAccount
	accountFound := false

	for _, account := range accounts {
		if account.ID != body.AccountId {
			continue
		}
		selectedAccount = account
		accountFound = true
		break
	}

	if !accountFound {
		WriteError(w, http.StatusNotFound, "account_not_found", "Аккаунт не найден")
		return
	}

	var afterMatchId *uint64 = nil

	ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
	defer cancel()

	if body.Mode == "incremental" {
		accountsDb, err := postgres.ListImportAccounts(ctx, h.DB)
		if err != nil {
			log.Printf("ошибка ListImportJobs, %v", err)
			WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось прогресс аккаунта")
			return
		}

		for _, account := range accountsDb {
			if account.Id != body.AccountId {
				continue
			}
			afterMatchId = account.LastCheckedMatchId
			break
		}
		if afterMatchId == nil {
			WriteError(w, http.StatusConflict, "sync_required", "Сначала запустите импорт истории")
			return
		}
	}

	job, err := postgres.CreateImportJob(ctx, h.DB, selectedAccount.ID, selectedAccount.Name, body.Mode, minMatchID, afterMatchId)

	var pgErr *pgconn.PgError

	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" && pgErr.ConstraintName == "import_jobs_one_active_per_account" {
			WriteError(w, http.StatusConflict, "account_busy", "У аккаунта уже есть активное задание")
			return
		}
	}

	if err != nil {
		log.Printf("ошибка CreateImportJob, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не создать задачу")
		return
	}

	jobDTO := dto.MapImportJob(*job)

	response := dto.ImportJobResponse{Job: jobDTO}

	w.Header().Set("content-type", "application/json")

	w.WriteHeader(http.StatusAccepted)

	err = json.NewEncoder(w).Encode(response)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}
