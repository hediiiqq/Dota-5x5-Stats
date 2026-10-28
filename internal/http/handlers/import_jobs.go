package handlers

import (
	"context"
	"dota-stats/internal/auth"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
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
