package handlers

import (
	"dota-stats/internal/http/dto"
	"encoding/json"
	"log"
	"net/http"
)

func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	err := json.NewEncoder(w).Encode(dto.ErrorResponse{
		Error: dto.APIError{
			Code:    code,
			Message: message,
		},
	})
	if err != nil {
		log.Printf("Не удалось записать JSON-ошибку: %v", err)
	}
}
