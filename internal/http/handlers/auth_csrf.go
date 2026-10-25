package handlers

import (
	"dota-stats/internal/auth"
	"errors"
	"net/http"
)

func (h *AuthHandler) CheckCSRF(r *http.Request) bool {

	origin := r.Header.Get("origin")

	if origin == "" || h.Config.PublicBaseURL != origin {
		return false
	}

	cookie, err := r.Cookie("__Host-dota_admin")

	if errors.Is(err, http.ErrNoCookie) {
		return false
	}

	if err != nil {
		return false
	}

	csrfToken := r.Header.Get("X-Csrf-Token")

	if csrfToken == "" {
		return false
	}

	return auth.ValidateCSRFToken(cookie.Value, csrfToken, h.Config.CSRFSecret)

}
