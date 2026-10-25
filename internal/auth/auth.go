package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"log"
)

func GenerateSessionToken() (string, error) {

	b := make([]byte, 32)

	_, err := rand.Read(b)

	if err != nil {
		log.Printf("Error generating session token: %v", err)
		return "", err
	}

	token := base64.RawURLEncoding.EncodeToString(b)

	return token, nil

}

func HashSessionToken(sessionToken string) string {

	hash := sha256.Sum256([]byte(sessionToken))
	return hex.EncodeToString(hash[:])
}
