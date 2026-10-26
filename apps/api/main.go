package main

import (
	"context"
	"database/sql"
	_ "embed"
	"log"
	"net/http"
	"time"

	"github.com/eldarknz/complan/apps/api/internal/catalog"
	"github.com/eldarknz/complan/apps/api/internal/config"
	"github.com/eldarknz/complan/apps/api/internal/projects"
	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed openapi.yaml
var openAPISpec []byte

func main() {
	cfg := config.Load()
	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /health/db", databaseHealthHandler(db))
	mux.HandleFunc("GET /api/v1/catalog/sewerage", catalog.Handler(db))
	mux.HandleFunc("GET /openapi.yaml", openAPIHandler)
	mux.HandleFunc("GET /swagger", swaggerHandler)
	mux.Handle("/api/v1/projects", projects.Handler(db))
	mux.Handle("/api/v1/projects/", projects.Handler(db))

	log.Printf("COMPLAN API слушает %s", cfg.Address)
	log.Fatal(http.ListenAndServe(cfg.Address, mux))
}

func openAPIHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	_, _ = w.Write(openAPISpec)
}

func swaggerHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>COMPLAN API Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`))
}

func databaseHealthHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			http.Error(w, `{"status":"error"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
