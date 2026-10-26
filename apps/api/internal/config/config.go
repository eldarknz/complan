package config

import "os"

const defaultAddress = ":8080"

type Config struct {
	Address string
}

func Load() Config {
	address := os.Getenv("COMPLAN_API_ADDRESS")
	if address == "" {
		address = defaultAddress
	}

	return Config{Address: address}
}
