package main

import (
	"log"
	"net/http"

	"github.com/eldarknz/complan/apps/api/internal/config"
)

func main() {
	cfg := config.Load()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)

	log.Printf("COMPLAN API слушает %s", cfg.Address)
	log.Fatal(http.ListenAndServe(cfg.Address, mux))
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
