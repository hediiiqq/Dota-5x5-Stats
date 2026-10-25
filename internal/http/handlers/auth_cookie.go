package handlers

import (
	"net/http"
	"time"
)

func SetAdminSessionCookie(w http.ResponseWriter, sessionToken string, expiresAt time.Time) {

	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge <= 0 {
		ClearAdminSessionCookie(w)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "__Host-dota_admin",
		Value:    sessionToken,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAge,
	})
}

func ClearAdminSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "__Host-dota_admin",
		MaxAge:   -1,
		Value:    "",
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(1, 0).UTC(),
	})
}

func SetAdminLoginCookie(w http.ResponseWriter, browserToken string, expiresAt time.Time) {

	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge <= 0 {
		ClearAdminLoginCookie(w)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "__Host-dota_admin_login",
		Value:    browserToken,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAge,
	})
}

func ClearAdminLoginCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "__Host-dota_admin_login",
		MaxAge:   -1,
		Value:    "",
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(1, 0).UTC(),
	})
}
