package config

import "os"

const (
	defaultAddress  = ":8080"
	defaultDatabase = "postgres://complan:complan@localhost:5432/complan?sslmode=disable"
)

type Config struct {
	Address     string
	DatabaseURL string
}

func Load() Config {
	address := os.Getenv("COMPLAN_API_ADDRESS")
	if address == "" {
		address = defaultAddress
	}

	databaseURL := os.Getenv("COMPLAN_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = defaultDatabase
	}

	return Config{Address: address, DatabaseURL: databaseURL}
}
