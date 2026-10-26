package projects

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type document struct {
	Version     int               `json:"version"`
	Units       string            `json:"units"`
	Elements    []json.RawMessage `json:"elements"`
	Connections json.RawMessage   `json:"connections"`
}

type request struct {
	Name     string          `json:"name"`
	Document json.RawMessage `json:"document"`
}

func Handler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/projects", create(db))
	mux.HandleFunc("GET /api/v1/projects", list(db))
	mux.HandleFunc("GET /api/v1/projects/{id}", get(db))
	mux.HandleFunc("PUT /api/v1/projects/{id}", save(db))
	mux.HandleFunc("POST /api/v1/projects/{id}/clear", clear(db))
	mux.HandleFunc("DELETE /api/v1/projects/{id}", remove(db))
	return cors(mux)
}

func clear(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := db.ExecContext(r.Context(), `UPDATE projects SET document = '{"version":3,"units":"mm","elements":[],"connections":[]}', updated_at = now() WHERE id = $1 AND owner_key = $2`, r.PathValue("id"), owner(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось очистить проект")
			return
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			writeError(w, http.StatusNotFound, "Проект не найден")
			return
		}
		if _, err := db.ExecContext(r.Context(), `DELETE FROM project_components WHERE project_id = $1`, r.PathValue("id")); err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось очистить компоненты проекта")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": r.PathValue("id")})
	}
}

func remove(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := db.ExecContext(r.Context(), `DELETE FROM projects WHERE id = $1 AND owner_key = $2`, r.PathValue("id"), owner(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось удалить проект")
			return
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			writeError(w, http.StatusNotFound, "Проект не найден")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func list(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryContext(r.Context(), `SELECT id, name, updated_at FROM projects WHERE owner_key = $1 ORDER BY updated_at DESC`, owner(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось получить список проектов")
			return
		}
		defer rows.Close()
		projects := make([]map[string]string, 0)
		for rows.Next() {
			var id, name string
			var updated time.Time
			if err := rows.Scan(&id, &name, &updated); err != nil {
				writeError(w, http.StatusInternalServerError, "Не удалось прочитать список проектов")
				return
			}
			projects = append(projects, map[string]string{"id": id, "name": name, "updated": updated.UTC().Format(time.RFC3339)})
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось прочитать список проектов")
			return
		}
		writeJSON(w, http.StatusOK, projects)
	}
}

func create(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input request
		if err := decodeRequest(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		id := newID()
		if err := store(r.Context(), db, id, owner(r), input, false); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func get(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var name string
		var raw []byte
		err := db.QueryRowContext(r.Context(), `SELECT name, document FROM projects WHERE id = $1 AND owner_key = $2`, r.PathValue("id"), owner(r)).Scan(&name, &raw)
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "Проект не найден")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось получить проект")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": r.PathValue("id"), "name": name, "document": json.RawMessage(raw)})
	}
}

func save(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input request
		if err := decodeRequest(r, &input); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := store(r.Context(), db, r.PathValue("id"), owner(r), input, true); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": r.PathValue("id")})
	}
}

func store(ctx context.Context, db *sql.DB, id, ownerKey string, input request, update bool) error {
	var doc document
	if err := json.Unmarshal(input.Document, &doc); err != nil || doc.Version != 3 || doc.Units != "mm" || len(doc.Elements) > 500 {
		return errInvalidDocument
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Новый проект"
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if update {
		result, err := tx.ExecContext(ctx, `UPDATE projects SET name = $1, document = $2, updated_at = now() WHERE id = $3 AND owner_key = $4`, name, input.Document, id, ownerKey)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return errNotFound
		}
	} else if _, err := tx.ExecContext(ctx, `INSERT INTO projects (id, owner_key, name, document) VALUES ($1, $2, $3, $4)`, id, ownerKey, name, input.Document); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_components WHERE project_id = $1`, id); err != nil {
		return err
	}
	for index, raw := range doc.Elements {
		var element struct {
			TypeID     string    `json:"typeId"`
			Length     float64   `json:"length"`
			Position   []float64 `json:"position"`
			Quaternion []float64 `json:"quaternion"`
			Color      *string   `json:"color"`
		}
		if json.Unmarshal(raw, &element) != nil || element.TypeID == "" || element.Length <= 0 || len(element.Position) != 3 || len(element.Quaternion) != 4 {
			return errInvalidDocument
		}
		position, _ := json.Marshal(element.Position)
		quaternion, _ := json.Marshal(element.Quaternion)
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_components (project_id, element_index, component_id, length_mm, position, quaternion, color) VALUES ($1, $2, $3, $4, $5, $6, $7)`, id, index, element.TypeID, element.Length, position, quaternion, element.Color); err != nil {
			return err
		}
	}
	return tx.Commit()
}

var errInvalidDocument = &projectError{"Неверный документ проекта"}
var errNotFound = &projectError{"Проект не найден"}

type projectError struct{ message string }

func (e *projectError) Error() string { return e.message }

func decodeRequest(r *http.Request, value any) error {
	if err := json.NewDecoder(r.Body).Decode(value); err != nil {
		return &projectError{"Неверное тело запроса"}
	}
	return nil
}
func owner(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-User-Key"))
	if value == "" {
		return "anonymous"
	}
	return value
}
func newID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
