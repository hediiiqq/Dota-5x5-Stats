package httpapi

import (
	"dota-stats/internal/http/handlers"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(db *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()
	handler := handlers.MatchHandler{DB: db}

	mux.HandleFunc("GET /matches/{id}", handler.GetMatch)

	mux.HandleFunc("GET /matches", handler.ListMatches)

	return mux

}
