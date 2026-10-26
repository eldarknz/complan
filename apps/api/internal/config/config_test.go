package config

import "testing"

func TestLoadUsesDefaultAddress(t *testing.T) {
	t.Setenv("COMPLAN_API_ADDRESS", "")

	if got := Load().Address; got != defaultAddress {
		t.Fatalf("expected default address %q, got %q", defaultAddress, got)
	}
}

func TestLoadUsesEnvironmentAddress(t *testing.T) {
	const address = "127.0.0.1:9090"
	t.Setenv("COMPLAN_API_ADDRESS", address)

	if got := Load().Address; got != address {
		t.Fatalf("expected address %q, got %q", address, got)
	}
}

func TestLoadUsesEnvironmentDatabaseURL(t *testing.T) {
	const databaseURL = "postgres://user:password@localhost:5432/database"
	t.Setenv("COMPLAN_DATABASE_URL", databaseURL)

	if got := Load().DatabaseURL; got != databaseURL {
		t.Fatalf("expected database URL %q, got %q", databaseURL, got)
	}
}
