package handlers

import (
	"dota-stats/internal/auth"
	"dota-stats/internal/repository/postgres"
	"errors"
	"net/http"
	"net/url"
)

func (h *AuthHandler) SteamLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

	login, err := auth.PrepareSteamLogin(r.Context(), h.DB, h.Config)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось начать вход через Steam")
		return
	}

	SetAdminLoginCookie(w, login.BrowserToken, login.ExpiresAt)

	steamURL := auth.BuildSteamLoginURL(login.ReturnTo, h.Config.PublicBaseURL)

	http.Redirect(w, r, steamURL, http.StatusFound)

}

func (h *AuthHandler) SteamCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")

	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "steam_auth_invalid", "Не удалось начать вход через Steam")
		return
	}
	cookie, err := r.Cookie("__Host-dota_admin_login")

	if errors.Is(err, http.ErrNoCookie) {
		WriteError(w, http.StatusBadRequest, "steam_auth_invalid", "Попытка входа недействительна")
		return
	}

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "не предвиденная ошибка получения куки")
		return
	}

	token, expiresAt, err := auth.CompleteSteamLogin(r.Context(), h.DB, query, cookie.Value, h.Config)

	if err != nil {
		switch {
		case errors.Is(err, auth.ErrSteamAuthInvalid):
			WriteError(w, http.StatusBadRequest,
				"steam_auth_invalid", "Попытка входа недействительна")

		case errors.Is(err, auth.ErrAdminRequired):
			WriteError(w, http.StatusForbidden,
				"admin_required", "Нет прав администратора")

		case errors.Is(err, auth.ErrSteamAuthUnavailable):
			WriteError(w, http.StatusBadGateway,
				"steam_auth_unavailable", "Не удалось проверить ответ Steam")

		default:
			WriteError(w, http.StatusInternalServerError,
				"internal_error", "Не удалось завершить вход")
		}
		return
	}

	oldCookie, err := r.Cookie("__Host-dota_admin")
	if err != nil && !errors.Is(err, http.ErrNoCookie) {
		WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось прочитать cookie прежней сессии")
		return
	}

	if err == nil {
		err = postgres.RevokeAdminSession(r.Context(), h.DB, auth.HashSessionToken(oldCookie.Value))
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "internal_error", "Не удалось отозвать прежнюю сессию")
			return
		}
	}

	SetAdminSessionCookie(w, token, expiresAt)
	ClearAdminLoginCookie(w)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
