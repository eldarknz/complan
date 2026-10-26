CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_key TEXT NOT NULL DEFAULT 'anonymous',
    name TEXT NOT NULL DEFAULT 'Новый проект',
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_owner_key_idx ON projects (owner_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_components (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    element_index INTEGER NOT NULL CHECK (element_index >= 0),
    component_id TEXT NOT NULL REFERENCES catalog_items(id),
    length_mm NUMERIC NOT NULL CHECK (length_mm > 0),
    position JSONB NOT NULL,
    quaternion JSONB NOT NULL,
    color TEXT,
    PRIMARY KEY (project_id, element_index)
);

CREATE INDEX IF NOT EXISTS project_components_component_idx ON project_components (component_id);
