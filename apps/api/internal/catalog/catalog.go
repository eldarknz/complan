package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

type Component struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Kind             string    `json:"kind"`
	Description      string    `json:"description"`
	DiameterMM       int       `json:"diameter_mm"`
	BranchDiameterMM *int      `json:"branch_diameter_mm,omitempty"`
	OutletDiameterMM *int      `json:"outlet_diameter_mm,omitempty"`
	AngleDegrees     *float64  `json:"angle_degrees,omitempty"`
	DefaultLengthMM  float64   `json:"default_length_mm"`
	Accessory        bool      `json:"accessory"`
	Plain            bool      `json:"plain"`
	Cuff             bool      `json:"cuff"`
	Fixed            bool      `json:"fixed"`
	SocketDepthMM    *float64  `json:"socket_depth_mm,omitempty"`
	Plastic          bool      `json:"plastic"`
	TwoPlane         bool      `json:"two_plane"`
	Eccentric        bool      `json:"eccentric"`
	Internal         bool      `json:"internal"`
	Lengths          []float64 `json:"lengths"`
	Ports            []Port    `json:"ports"`
}

type Port struct {
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	DiameterMM int     `json:"diameter_mm"`
	Position   Vector  `json:"position"`
	Direction  Vector  `json:"direction"`
	Socket     bool    `json:"socket"`
	DepthMM    float64 `json:"depth_mm"`
}

type Vector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func Handler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		components, err := list(ctx, db)
		if err != nil {
			http.Error(w, `{"error":"не удалось получить каталог канализации"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(components)
	}
}

func list(ctx context.Context, db *sql.DB) ([]Component, error) {
	const query = `SELECT ci.id, ci.name, ci.kind, ci.description,
 sc.diameter_mm, sc.branch_diameter_mm, sc.outlet_diameter_mm, sc.angle_degrees,
 sc.default_length_mm, sc.is_accessory, sc.is_plain, sc.is_cuff, sc.is_fixed,
 sc.socket_depth_mm, sc.is_plastic, sc.is_two_plane, sc.is_eccentric, sc.is_internal,
 COALESCE((SELECT json_agg(l.length_mm ORDER BY l.length_mm) FROM sewerage_component_lengths l WHERE l.component_id = ci.id), '[]'),
 COALESCE((SELECT json_agg(json_build_object('code', p.port_code, 'name', p.name, 'diameter_mm', p.diameter_mm, 'position', json_build_object('x', p.position_x_mm, 'y', p.position_y_mm, 'z', p.position_z_mm), 'direction', json_build_object('x', p.direction_x, 'y', p.direction_y, 'z', p.direction_z), 'socket', p.is_socket, 'depth_mm', p.depth_mm) ORDER BY p.port_code) FROM sewerage_component_ports p WHERE p.component_id = ci.id), '[]')
 FROM catalog_items ci JOIN sewerage_components sc ON sc.catalog_item_id = ci.id
 JOIN disciplines d ON d.id = ci.discipline_id
 WHERE d.code = 'sewerage' AND ci.is_active ORDER BY ci.id`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Component, 0)
	for rows.Next() {
		var item Component
		var lengths, ports []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.Kind, &item.Description, &item.DiameterMM, &item.BranchDiameterMM, &item.OutletDiameterMM, &item.AngleDegrees, &item.DefaultLengthMM, &item.Accessory, &item.Plain, &item.Cuff, &item.Fixed, &item.SocketDepthMM, &item.Plastic, &item.TwoPlane, &item.Eccentric, &item.Internal, &lengths, &ports); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(lengths, &item.Lengths); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(ports, &item.Ports); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
