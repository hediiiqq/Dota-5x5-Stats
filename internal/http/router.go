package httpapi

import (
	"dota-stats/internal/config"
	"dota-stats/internal/http/handlers"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(db *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()
	handler := handlers.MatchHandler{DB: db}
	avatars := handlers.NewAvatarHandler(config.SteamWebAPIKey())
	profiles := handlers.NewProfileHandler(config.StratzToken())

	mux.HandleFunc("GET /api/matches/{id}", handler.GetMatch)
	mux.HandleFunc("GET /api/matches/{id}/purchases", handler.GetMetadata)

	mux.HandleFunc("GET /api/matches", handler.ListMatches)

	mux.HandleFunc("GET /api/health", handler.Health)
	mux.HandleFunc("GET /api/players/avatars", avatars.GetAvatars)
	mux.HandleFunc("GET /api/players/{id}/profile", profiles.GetProfile)

	mux.HandleFunc("GET /api/matches/{id}/inventory", handler.GetInventory)
	mux.HandleFunc("GET /api/matches/{id}/graphs", handler.GetGraphs)

	methodNotAllowed := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, HEAD")
		handlers.WriteError(w, http.StatusMethodNotAllowed,
			"method_not_allowed", "Метод не поддерживается")
	}

	mux.HandleFunc("/api/matches", methodNotAllowed)
	mux.HandleFunc("/api/matches/{id}", methodNotAllowed)
	mux.HandleFunc("/api/matches/{id}/purchases", methodNotAllowed)
	mux.HandleFunc("/api/health", methodNotAllowed)
	mux.HandleFunc("/api/players/avatars", methodNotAllowed)
	mux.HandleFunc("/api/players/{id}/profile", methodNotAllowed)
	mux.HandleFunc("/api/matches/{id}/inventory", methodNotAllowed)
	mux.HandleFunc("/api/matches/{id}/graphs", methodNotAllowed)

	registerWebRoutes(mux)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		handlers.WriteError(w, http.StatusNotFound,
			"not_found", "Маршрут не найден")
	})

	return mux

}
