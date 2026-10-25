package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

func GenerateCSRFToken(sessionToken string, secret []byte) string {

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("admin-csrf:v1:" + sessionToken))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

}

func ValidateCSRFToken(sessionToken string, csrfToken string, secret []byte) bool {

	if sessionToken == "" || csrfToken == "" {
		return false
	}
	csrf := GenerateCSRFToken(sessionToken, secret)

	return hmac.Equal([]byte(csrf), []byte(csrfToken))

}
