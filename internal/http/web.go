package httpapi

import (
	"dota-stats/internal/http/handlers"
	"net/http"
)

// registerWebRoutes serves only explicitly listed public files. The rest of the
// repository, including configuration and source files, is never a file root.
func registerWebRoutes(mux *http.ServeMux) {
	files := []struct {
		pattern     string
		file        string
		contentType string
	}{
		{"/{$}", "web/index.html", "text/html; charset=utf-8"},
		{"/match", "web/match.html", "text/html; charset=utf-8"},
		{"/assets/styles.css", "web/assets/styles.css", "text/css; charset=utf-8"},
		{"/assets/common.js", "web/assets/common.js", "text/javascript; charset=utf-8"},
		{"/assets/history.js", "web/assets/history.js", "text/javascript; charset=utf-8"},
		{"/assets/balancer.js", "web/assets/balancer.js", "text/javascript; charset=utf-8"},
		{"/assets/balancer-view.js", "web/assets/balancer-view.js", "text/javascript; charset=utf-8"},
		{"/assets/insights.js", "web/assets/insights.js", "text/javascript; charset=utf-8"},
		{"/assets/insights-view.js", "web/assets/insights-view.js", "text/javascript; charset=utf-8"},
		{"/assets/favorites.js", "web/assets/favorites.js", "text/javascript; charset=utf-8"},
		{"/assets/match.js", "web/assets/match.js", "text/javascript; charset=utf-8"},
		{"/assets/match-records.js", "web/assets/match-records.js", "text/javascript; charset=utf-8"},
		{"/assets/draft.js", "web/assets/draft.js", "text/javascript; charset=utf-8"},
		{"/assets/scoreboard.js", "web/assets/scoreboard.js", "text/javascript; charset=utf-8"},
		{"/assets/inventory.js", "web/assets/inventory.js", "text/javascript; charset=utf-8"},
		{"/assets/graphs.js", "web/assets/graphs.js", "text/javascript; charset=utf-8"},
		{"/assets/items.js", "web/assets/items.js", "text/javascript; charset=utf-8"},
		{"/assets/match.css", "web/assets/match.css", "text/css; charset=utf-8"},
	}
	for _, file := range files {
		mux.HandleFunc("GET "+file.pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", file.contentType)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, file.file)
		})
		mux.HandleFunc(file.pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Allow", "GET, HEAD")
			handlers.WriteError(w, http.StatusMethodNotAllowed,
				"method_not_allowed", "Метод не поддерживается")
		})
	}
}
