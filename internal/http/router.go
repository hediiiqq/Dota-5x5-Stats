package httpapi

import (
	"dota-stats/internal/config"
	"dota-stats/internal/http/handlers"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(db *pgxpool.Pool, auth config.AuthConfig) *http.ServeMux {
	mux := http.NewServeMux()
	handler := handlers.MatchHandler{DB: db}
	authHandler := handlers.AuthHandler{DB: db, Config: auth}
	noticeHandler := handlers.SiteNoticeHandler{Db: db}
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

	mux.HandleFunc("GET /api/admin/session", authHandler.GetSession)
	mux.HandleFunc("POST /api/admin/logout", authHandler.Logout)
	mux.HandleFunc("POST /api/admin/logout-all", authHandler.LogoutAll)
	mux.HandleFunc("GET /auth/steam", authHandler.SteamLogin)
	mux.HandleFunc("GET /auth/steam/callback", authHandler.SteamCallback)

	mux.HandleFunc("GET /api/notices", noticeHandler.ListNotices)
	mux.HandleFunc("GET /api/admin/notices", authHandler.ListAdminNotices)
	mux.HandleFunc("POST /api/admin/notices", authHandler.CreateNotice)
	mux.HandleFunc("PUT /api/admin/notices/{id}", authHandler.UpdateNotice)
	mux.HandleFunc("DELETE /api/admin/notices/{id}", authHandler.DeleteNotice)
	mux.HandleFunc("GET /api/admin/import-accounts", authHandler.ListImportAccounts)

	methodNotAllowed := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, HEAD")
		handlers.WriteError(w, http.StatusMethodNotAllowed,
			"method_not_allowed", "Метод не поддерживается")
	}

	postMethodNotAllowed := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "POST")
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
	mux.HandleFunc("/api/admin/session", methodNotAllowed)

	mux.HandleFunc("/api/admin/logout", postMethodNotAllowed)
	mux.HandleFunc("/api/admin/logout-all", postMethodNotAllowed)
	mux.HandleFunc("/auth/steam", methodNotAllowed)
	mux.HandleFunc("/auth/steam/callback", methodNotAllowed)
	mux.HandleFunc("/api/admin/import-accounts", methodNotAllowed)

	mux.HandleFunc("/api/notices", methodNotAllowed)
	mux.HandleFunc("/api/admin/notices", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, HEAD, POST")
		handlers.WriteError(w, http.StatusMethodNotAllowed,
			"method_not_allowed", "Метод не поддерживается")
	})

	mux.HandleFunc("/api/admin/notices/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "PUT, DELETE")
		handlers.WriteError(w, http.StatusMethodNotAllowed,
			"method_not_allowed", "Метод не поддерживается")
	})

	registerWebRoutes(mux)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		handlers.WriteError(w, http.StatusNotFound,
			"not_found", "Маршрут не найден")
	})

	return mux

}
