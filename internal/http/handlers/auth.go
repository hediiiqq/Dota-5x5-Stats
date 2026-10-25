package handlers

import (
	"dota-stats/internal/auth"
	"dota-stats/internal/config"
	"dota-stats/internal/http/dto"
	"dota-stats/internal/repository/postgres"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuthHandler struct {
	DB     *pgxpool.Pool
	Config config.AuthConfig
}

func (h *AuthHandler) SessionFromRequest(r *http.Request) (string, time.Time, error) {

	cookie, err := r.Cookie("__Host-dota_admin")

	if errors.Is(err, http.ErrNoCookie) {
		return "", time.Time{}, auth.ErrUnauthenticated
	}

	if err != nil {
		log.Printf("Failed to get cookie from request: %v", err)
		return "", time.Time{}, err
	}

	steamId64, expiresAt, err := auth.ValidateSession(r.Context(), h.DB, cookie.Value, h.Config)

	if err != nil {
		return "", time.Time{}, err
	}

	return steamId64, expiresAt, nil
}

func (h *AuthHandler) GetSession(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("Cache-Control", "no-store")

	steamId64, expiresAt, err := h.SessionFromRequest(r)

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

	cookie, err := r.Cookie("__Host-dota_admin")

	if errors.Is(err, http.ErrNoCookie) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "не предвиденная ошибка получения куки")
		return
	}

	token := auth.GenerateCSRFToken(cookie.Value, h.Config.CSRFSecret)

	response := dto.AdminSessionResponse{
		Admin:     dto.AdminIdentity{SteamID: steamId64},
		ExpiresAt: expiresAt,
		CSRFToken: token,
	}

	w.Header().Set("content-type", "application/json")
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		log.Printf("Failed to write response: %v", err)
		return
	}

}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
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

	response := h.CheckCSRF(r)

	if !response {
		WriteError(w, http.StatusForbidden, "csrf_invalid", "Проверка CSRF не пройдена")
		return
	}

	cookie, err := r.Cookie("__Host-dota_admin")

	if errors.Is(err, http.ErrNoCookie) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", auth.ErrUnauthenticated.Error())
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "не предвиденная ошибка получения куки")
		return
	}

	hash := auth.HashSessionToken(cookie.Value)

	err = postgres.RevokeAdminSession(r.Context(), h.DB, hash)

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось отозвать сессию")
		return
	}

	ClearAdminSessionCookie(w)

	w.WriteHeader(http.StatusNoContent)

	return

}

func (h *AuthHandler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

	steamID64, _, err := h.SessionFromRequest(r)

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

	response := h.CheckCSRF(r)

	if !response {
		WriteError(w, http.StatusForbidden, "csrf_invalid", "Проверка CSRF не пройдена")
		return
	}

	err = postgres.RevokeAllAdminSessions(r.Context(), h.DB, steamID64)

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось отозвать сессию")
		return
	}

	ClearAdminSessionCookie(w)

	w.WriteHeader(http.StatusNoContent)

	return

}
