package main

import "testing"

func TestCatalogContainsAllSewerageComponents(t *testing.T) {
	items := catalog()
	if len(items) != 73 {
		t.Fatalf("expected 73 components, got %d", len(items))
	}

	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if seen[item.id] {
			t.Fatalf("duplicate component %q", item.id)
		}
		seen[item.id] = true
	}
}
