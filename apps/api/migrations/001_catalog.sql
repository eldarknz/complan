CREATE TABLE IF NOT EXISTS disciplines (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    discipline_id BIGINT NOT NULL REFERENCES disciplines(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sewerage_components (
    catalog_item_id TEXT PRIMARY KEY REFERENCES catalog_items(id) ON DELETE CASCADE,
    diameter_mm INTEGER NOT NULL CHECK (diameter_mm > 0),
    branch_diameter_mm INTEGER CHECK (branch_diameter_mm > 0),
    outlet_diameter_mm INTEGER CHECK (outlet_diameter_mm > 0),
    angle_degrees NUMERIC,
    default_length_mm NUMERIC NOT NULL CHECK (default_length_mm > 0),
    is_accessory BOOLEAN NOT NULL DEFAULT FALSE,
    is_plain BOOLEAN NOT NULL DEFAULT FALSE,
    is_cuff BOOLEAN NOT NULL DEFAULT FALSE,
    is_fixed BOOLEAN NOT NULL DEFAULT FALSE,
    socket_depth_mm NUMERIC,
    is_plastic BOOLEAN NOT NULL DEFAULT FALSE,
    is_two_plane BOOLEAN NOT NULL DEFAULT FALSE,
    is_eccentric BOOLEAN NOT NULL DEFAULT FALSE,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sewerage_component_lengths (
    component_id TEXT NOT NULL REFERENCES sewerage_components(catalog_item_id) ON DELETE CASCADE,
    length_mm NUMERIC NOT NULL CHECK (length_mm > 0),
    PRIMARY KEY (component_id, length_mm)
);

CREATE TABLE IF NOT EXISTS sewerage_component_ports (
    component_id TEXT NOT NULL REFERENCES sewerage_components(catalog_item_id) ON DELETE CASCADE,
    port_code TEXT NOT NULL,
    name TEXT NOT NULL,
    diameter_mm INTEGER NOT NULL CHECK (diameter_mm > 0),
    position_x_mm NUMERIC NOT NULL,
    position_y_mm NUMERIC NOT NULL,
    position_z_mm NUMERIC NOT NULL,
    direction_x NUMERIC NOT NULL,
    direction_y NUMERIC NOT NULL,
    direction_z NUMERIC NOT NULL,
    is_socket BOOLEAN NOT NULL,
    depth_mm NUMERIC NOT NULL,
    PRIMARY KEY (component_id, port_code)
);

CREATE INDEX IF NOT EXISTS catalog_items_discipline_idx ON catalog_items (discipline_id);
CREATE INDEX IF NOT EXISTS sewerage_components_kind_idx ON sewerage_components (is_accessory, diameter_mm);
