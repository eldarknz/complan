package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"

	"github.com/eldarknz/complan/apps/api/internal/config"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type component struct {
	id, name, kind, description string
	diameter                    int
	length                      float64
	branch, outlet, angle       *int
	lengths                     []float64
	accessory, plain, cuff      bool
	fixed, plastic, twoPlane    bool
	eccentric, internal         bool
	socketDepth                 *float64
}

func main() {
	cfg := config.Load()
	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	migrationBytes, err := os.ReadFile("migrations/001_catalog.sql")
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		log.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, string(migrationBytes)); err != nil {
		log.Fatal(err)
	}
	projectMigration, err := os.ReadFile("migrations/002_projects.sql")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, string(projectMigration)); err != nil {
		log.Fatal(err)
	}
	if err := seed(ctx, db); err != nil {
		log.Fatal(err)
	}
	log.Printf("Каталог канализации заполнен: %d компонентов", len(catalog()))
}

func seed(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `INSERT INTO disciplines (code, name) VALUES ('sewerage', 'Канализация') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`); err != nil {
		return err
	}
	var disciplineID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM disciplines WHERE code = 'sewerage'`).Scan(&disciplineID); err != nil {
		return err
	}
	for _, item := range catalog() {
		if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_items (id, discipline_id, name, kind, description) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET discipline_id = EXCLUDED.discipline_id, name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description, is_active = TRUE`, item.id, disciplineID, item.name, item.kind, item.description); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO sewerage_components (catalog_item_id, diameter_mm, branch_diameter_mm, outlet_diameter_mm, angle_degrees, default_length_mm, is_accessory, is_plain, is_cuff, is_fixed, socket_depth_mm, is_plastic, is_two_plane, is_eccentric, is_internal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (catalog_item_id) DO UPDATE SET diameter_mm = EXCLUDED.diameter_mm, branch_diameter_mm = EXCLUDED.branch_diameter_mm, outlet_diameter_mm = EXCLUDED.outlet_diameter_mm, angle_degrees = EXCLUDED.angle_degrees, default_length_mm = EXCLUDED.default_length_mm, is_accessory = EXCLUDED.is_accessory, is_plain = EXCLUDED.is_plain, is_cuff = EXCLUDED.is_cuff, is_fixed = EXCLUDED.is_fixed, socket_depth_mm = EXCLUDED.socket_depth_mm, is_plastic = EXCLUDED.is_plastic, is_two_plane = EXCLUDED.is_two_plane, is_eccentric = EXCLUDED.is_eccentric, is_internal = EXCLUDED.is_internal`, item.id, item.diameter, item.branch, item.outlet, item.angle, item.length, item.accessory, item.plain, item.cuff, item.fixed, item.socketDepth, item.plastic, item.twoPlane, item.eccentric, item.internal); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sewerage_component_lengths WHERE component_id = $1`, item.id); err != nil {
			return err
		}
		for _, length := range item.lengths {
			if _, err := tx.ExecContext(ctx, `INSERT INTO sewerage_component_lengths (component_id, length_mm) VALUES ($1, $2)`, item.id, length); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sewerage_component_ports WHERE component_id = $1`, item.id); err != nil {
			return err
		}
		for _, port := range ports(item) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO sewerage_component_ports (component_id, port_code, name, diameter_mm, position_x_mm, position_y_mm, position_z_mm, direction_x, direction_y, direction_z, is_socket, depth_mm) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, item.id, port.code, port.name, port.diameter, port.x, port.y, port.z, port.dx, port.dy, port.dz, port.socket, port.depth); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

type componentPort struct {
	code, name          string
	diameter            int
	x, y, z, dx, dy, dz float64
	socket              bool
	depth               float64
}

func ports(item component) []componentPort {
	if item.accessory {
		return nil
	}
	depth := func(d int) float64 {
		if d == 110 {
			return 60
		}
		return 30
	}
	in := componentPort{"in", "Гладкий конец", item.diameter, 0, 0, 0, -1, 0, 0, false, depth(item.diameter)}
	if item.kind == "coupling" {
		in.socket, in.depth, in.name = true, depth(item.diameter), "Раструб A"
	}
	if item.kind == "cap" || item.kind == "drain" || item.kind == "funnel" || item.kind == "toilet" || item.kind == "vacuum" {
		return []componentPort{in}
	}
	out := componentPort{"out", "Прямой выход", item.diameter, item.length, 0, 0, 1, 0, 0, true, depth(item.diameter)}
	if item.outlet != nil {
		out.diameter = *item.outlet
	}
	if item.plain {
		out.socket, out.depth, out.name, in.name = false, 0, "Гладкий конец B", "Гладкий конец A"
	}
	if item.kind == "elbow" {
		angle := radians(*item.angle)
		d := float64(item.diameter)
		out.name, out.x, out.y, out.dx, out.dy = fmt.Sprintf("Выход %d°", *item.angle), d*.7+d*math.Sin(angle)+d*.7*math.Cos(angle), d*(1-math.Cos(angle))+d*.7*math.Sin(angle), math.Cos(angle), math.Sin(angle)
	}
	result := []componentPort{in, out}
	if item.kind == "tee" || item.kind == "cross" {
		angle := radians(*item.angle)
		branch := *item.branch
		result = append(result, componentPort{"branch", fmt.Sprintf("Боковой выход %d°", *item.angle), branch, item.length*.45 + (float64(item.diameter)*.65+float64(branch))*math.Cos(angle), (float64(item.diameter)*.65 + float64(branch)) * math.Sin(angle), 0, math.Cos(angle), math.Sin(angle), 0, true, depth(branch)})
		if item.kind == "cross" {
			result = append(result, componentPort{"branch-b", fmt.Sprintf("Боковой выход B · %d°", *item.angle), branch, item.length*.45 + (float64(item.diameter)*.65+float64(branch))*math.Cos(angle), -(float64(item.diameter)*.65 + float64(branch)) * math.Sin(angle), 0, math.Cos(angle), -math.Sin(angle), 0, true, depth(branch)})
		}
	}
	return result
}

func radians(degrees int) float64 { return float64(degrees) * math.Pi / 180 }

func intPtr(value int) *int           { return &value }
func floatPtr(value float64) *float64 { return &value }

func catalog() []component {
	items := []component{
		{id: "pipe-110", name: "Труба HTEM Ø110", kind: "pipe", diameter: 110, length: 1000},
		{id: "tee-110-110-87", name: "Тройник HTEA Ø110/110/87°", kind: "tee", diameter: 110, branch: intPtr(110), angle: intPtr(87), description: "Для подключения унитаза"},
		{id: "tee-110-50-87", name: "Тройник HTEA Ø110/50/87°", kind: "tee", diameter: 110, branch: intPtr(50), angle: intPtr(87), description: "Ветка ванны и раковины"},
		{id: "tee-110-50-45", name: "Косой тройник HTEA Ø110/50/45°", kind: "tee", diameter: 110, branch: intPtr(50), angle: intPtr(45), description: "Кухня и ветки Ø50 в горизонтальный коллектор"},
		{id: "inspection-110", name: "Ревизия HTRE Ø110", kind: "inspection", diameter: 110},
		{id: "coupling-110", name: "Муфта HTU Ø110", kind: "coupling", diameter: 110, length: 150},
		{id: "cap-110", name: "Заглушка HTM Ø110", kind: "cap", diameter: 110, length: 65},
		{id: "toilet-110", name: "Манжета для унитаза Ø110", kind: "toilet", diameter: 110, length: 120},
		{id: "clamp-110", name: "Металлический хомут Ø110", kind: "clamp", diameter: 110, length: 28, accessory: true},
		{id: "fire-110", name: "Противопожарная муфта Ø110", kind: "fire", diameter: 110, length: 60, accessory: true, description: "Проход через межэтажное перекрытие"},
		{id: "sleeve-110", name: "Гильза DN150 под трубу Ø110", kind: "sleeve", diameter: 110, length: 220, accessory: true, description: "Проход через перекрытие"},
		{id: "roof-110", name: "Кровельная проходка Ø110", kind: "roof", diameter: 110, length: 230, accessory: true, description: "Для фановой трубы"},
		{id: "pipe-50", name: "Труба HTEM Ø50", kind: "pipe", diameter: 50, length: 1000},
		{id: "inspection-50", name: "Ревизия HTRE Ø50", kind: "inspection", diameter: 50},
		{id: "coupling-50", name: "Муфта HTU Ø50", kind: "coupling", diameter: 50, length: 90},
		{id: "cap-50", name: "Заглушка HTM Ø50", kind: "cap", diameter: 50, length: 40},
		{id: "reducer-50-40", name: "Переход Ø50/40", kind: "reducer", diameter: 50, outlet: intPtr(40), length: 90, description: "Для сифонов и стиральной машины"},
		{id: "drain-50", name: "Трап Ø50 с сухим затвором", kind: "drain", diameter: 50, length: 140, description: "Слив в бойлерной"},
		{id: "funnel-50", name: "Воронка разрыва струи Ø50", kind: "funnel", diameter: 50, length: 140, description: "Слив предохранительного клапана бойлера / котла"},
		{id: "clamp-50", name: "Металлический хомут Ø50", kind: "clamp", diameter: 50, length: 24, accessory: true},
		{id: "reducer-110-50", name: "Переход Ø110/50", kind: "reducer", diameter: 110, outlet: intPtr(50), length: 150},
		{id: "cross-110-110-87", name: "Крестовина HTDA Ø110/110", kind: "cross", diameter: 110, branch: intPtr(110), angle: intPtr(87)},
		{id: "cross-110-50-87", name: "Крестовина HTDA Ø110/50", kind: "cross", diameter: 110, branch: intPtr(50), angle: intPtr(87)},
		{id: "cross-50-50-87", name: "Крестовина HTDA Ø50/50", kind: "cross", diameter: 50, branch: intPtr(50), angle: intPtr(87)},
		{id: "fire-50", name: "Противопожарная манжета Ø50", kind: "fire", diameter: 50, length: 40, accessory: true},
		{id: "htsm-110", name: "Восстановитель раструба HTSM Ø110/110", kind: "coupling", diameter: 110, length: 130, description: "Эскизная модель восстановителя раструба"},
		{id: "cross-two-plane-110", name: "Крестовина HTED Ø110/110/110", kind: "cross", diameter: 110, branch: intPtr(110), angle: intPtr(87), twoPlane: true, description: "Угловая двухплоскостная"},
	}
	for _, diameter := range []int{50, 110} {
		pipe := find(items, fmt.Sprintf("pipe-%d", diameter))
		pipe.lengths = []float64{150, 250, 500, 750, 1000, 1500, 2000, 3000}
		plain := component{id: fmt.Sprintf("pipe-plain-%d", diameter), name: fmt.Sprintf("Труба HTGL Ø%d", diameter), kind: "pipe", diameter: diameter, length: 5000, lengths: []float64{5000}, plain: true}
		items = append(items, plain)
		for _, angle := range []int{15, 30, 45, 67, 87} {
			if findOptional(items, fmt.Sprintf("elbow-%d-%d", diameter, angle)) == nil {
				items = append(items, component{id: fmt.Sprintf("elbow-%d-%d", diameter, angle), name: fmt.Sprintf("Отвод HTB Ø%d/%d°", diameter, angle), kind: "elbow", diameter: diameter, length: float64(diameter) * 2.5, angle: intPtr(angle)})
			}
		}
		items = append(items,
			component{id: fmt.Sprintf("htmm-%d", diameter), name: fmt.Sprintf("Муфта HTMM Ø%d", diameter), kind: "coupling", diameter: diameter, length: float64(diameter) * 1.8, description: "Двойная, двухраструбная"},
			component{id: fmt.Sprintf("htam-%d", diameter), name: fmt.Sprintf("Муфта HTAM Ø%d", diameter), kind: "coupling", diameter: diameter, length: float64(diameter) * 1.6, cuff: true, description: "Насадная с уплотнительной манжетой"},
			component{id: fmt.Sprintf("htl-%d", diameter), name: fmt.Sprintf("Муфта HTL Ø%d", diameter), kind: "pipe", diameter: diameter, length: float64(diameter) * 3, fixed: true, socketDepth: floatPtr(float64(diameter) * 1.4)},
			component{id: fmt.Sprintf("vacuum-%d", diameter), name: fmt.Sprintf("Клапан вакуумный Ø%d", diameter), kind: "vacuum", diameter: diameter, length: float64(diameter) * 1.8},
			component{id: fmt.Sprintf("check-%d", diameter), name: fmt.Sprintf("Обратный клапан Ø%d", diameter), kind: "check", diameter: diameter, length: float64(diameter) * 3},
			component{id: fmt.Sprintf("clamp-plastic-%d", diameter), name: fmt.Sprintf("Пластиковый хомут Ø%d", diameter), kind: "clamp", diameter: diameter, length: 25, accessory: true, plastic: true},
		)
	}
	for _, pair := range [][2]int{{50, 50}, {50, 40}, {110, 50}, {110, 75}, {110, 110}} {
		for _, angle := range []int{45, 67, 87} {
			id := fmt.Sprintf("tee-%d-%d-%d", pair[0], pair[1], angle)
			if findOptional(items, id) == nil {
				items = append(items, component{id: id, name: fmt.Sprintf("Тройник HTEA Ø%d/%d/%d°", pair[0], pair[1], angle), kind: "tee", diameter: pair[0], branch: intPtr(pair[1]), angle: intPtr(angle), length: float64(pair[0]) * 2.5})
			}
		}
	}
	for _, pair := range [][2]int{{50, 40}, {110, 50}, {110, 75}, {110, 90}} {
		for _, suffix := range []string{"", "ecc-", "inner-"} {
			kind := "reducer"
			length := 150.0
			if suffix == "ecc-" {
				length = float64(pair[0]) * 1.8
			}
			if suffix == "inner-" {
				length = 100
				if pair[0] == 50 {
					length = 65
				}
			}
			id := fmt.Sprintf("reducer-%s%d-%d", suffix, pair[0], pair[1])
			if findOptional(items, id) == nil {
				items = append(items, component{id: id, name: fmt.Sprintf("Редукция Ø%d/%d", pair[0], pair[1]), kind: kind, diameter: pair[0], outlet: intPtr(pair[1]), length: length, eccentric: suffix == "ecc-", internal: suffix == "inner-"})
			}
		}
	}
	for i := range items {
		if items[i].length == 0 {
			items[i].length = float64(items[i].diameter) * 2.5
		}
	}
	return items
}

func find(items []component, id string) *component { return findOptional(items, id) }
func findOptional(items []component, id string) *component {
	for i := range items {
		if items[i].id == id {
			return &items[i]
		}
	}
	return nil
}
