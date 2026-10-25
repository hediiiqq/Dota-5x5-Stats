package handlers

import (
	"context"
	"dota-stats/internal/auth"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SiteNoticeHandler struct {
	Db *pgxpool.Pool
}

func (h *SiteNoticeHandler) ListNotices(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	notices, err := postgres.ListSiteNotices(ctx, h.Db)
	if err != nil {
		log.Println(err)
		WriteError(w, http.StatusInternalServerError,
			"internal_error", "Не удалось получить плашки")
		return
	}

	noticesDTO := make([]dto.SiteNotice, 0, len(notices))

	for _, n := range notices {

		notice := dto.SiteNotice{
			Id:   strconv.FormatInt(n.Id, 10),
			Text: n.Text,
		}
		noticesDTO = append(noticesDTO, notice)

	}
	response := dto.SiteNoticesResponse{Items: noticesDTO}

	w.Header().Set("Content-Type", "application/json")

	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}
}

func (h *AuthHandler) ListAdminNotices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

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

	handler := SiteNoticeHandler{Db: h.DB}

	handler.ListNotices(w, r)

}

func (h *AuthHandler) CreateNotice(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Cache-Control", "no-store")
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

	body := dto.SiteNoticeRequest{}

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

	text := strings.TrimSpace(body.Text)

	if utf8.RuneCountInString(text) < 1 || utf8.RuneCountInString(text) > 500 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Текст должен содержать от 1 до 500 символов")
		return
	}

	notice, err := postgres.CreateSiteNotice(r.Context(), h.DB, text)
	if err != nil {
		log.Printf("ошибка CreateSiteNotice, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось создать плашку")
		return
	}

	ansNotice := dto.SiteNotice{Id: strconv.FormatInt(notice.Id, 10), Text: notice.Text}

	w.Header().Set("Content-Type", "application/json")

	w.WriteHeader(http.StatusCreated)

	err = json.NewEncoder(w).Encode(ansNotice)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}

func (h *AuthHandler) UpdateNotice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
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

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)

	if err != nil || id <= 0 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "ID должен быть положительным целым числом")
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

	body := dto.SiteNoticeRequest{}

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

	text := strings.TrimSpace(body.Text)

	if utf8.RuneCountInString(text) < 1 || utf8.RuneCountInString(text) > 500 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Текст должен содержать от 1 до 500 символов")
		return
	}

	notice, found, err := postgres.UpdateSiteNotice(r.Context(), h.DB, id, text)

	if err != nil {
		log.Printf("ошибка UpdateSiteNotice, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось изменить плашку")
		return
	}

	if !found {
		WriteError(w, http.StatusNotFound, "notice_not_found", "Плашка не найдена")
		return
	}

	ansNotice := dto.SiteNotice{Id: strconv.FormatInt(notice.Id, 10), Text: notice.Text}

	w.Header().Set("Content-Type", "application/json")

	w.WriteHeader(http.StatusOK)

	err = json.NewEncoder(w).Encode(ansNotice)

	if err != nil {
		log.Printf("Надпись: не удалось записать JSON-ответ,%v", err)
		return
	}

}

func (h *AuthHandler) DeleteNotice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
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

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)

	if err != nil || id <= 0 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "ID должен быть положительным целым числом")
		return
	}

	found, err := postgres.DeleteSiteNotice(r.Context(), h.DB, id)

	if err != nil {
		log.Printf("ошибка DeleteSiteNotice, %v", err)
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось удалить плашку")
		return
	}
	if !found {
		WriteError(w, http.StatusNotFound, "notice_not_found", "Плашка не найдена")
		return
	}

	w.WriteHeader(http.StatusNoContent)

}
