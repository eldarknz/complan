# COMPLAN API

Минимальный HTTP API на Go.

## Запуск

Из корня репозитория:

```sh
go -C apps/api run .
```

По умолчанию сервер слушает `:8080`. Адрес можно изменить через переменную окружения:

```sh
COMPLAN_API_ADDRESS=127.0.0.1:9090 go -C apps/api run .
```

Для подключения к PostgreSQL используется `COMPLAN_DATABASE_URL`. По умолчанию:
`postgres://complan:complan@localhost:5432/complan?sslmode=disable`.

Запуск локальной базы данных:

```sh
docker compose up -d postgres
go -C apps/api run .
```

Создание таблиц и загрузка каталога канализации:

```sh
go run ./apps/api/cmd/seed
```

Команда создаёт таблицы из миграции и идемпотентно загружает компоненты, допустимые длины и порты. Повторный запуск обновляет существующие записи.

## API каталога

После запуска API список компонентов доступен по адресу `GET /api/v1/catalog/sewerage`. Описание OpenAPI находится в `apps/api/openapi.yaml`.

Swagger UI доступен по адресу `http://localhost:8080/swagger`, а исходный OpenAPI-документ — по адресу `http://localhost:8080/openapi.yaml`.

Контракт Protocol Buffers находится в `api/proto/catalog/v1/catalog.proto`. Для генерации Go-кода нужны `protoc` и `protoc-gen-go`, после их установки выполните `make api-proto`.

## Проекты

Миграция `002_projects.sql` создаёт таблицы `projects` и `project_components`. Сейчас вместо авторизации используется заголовок `X-User-Key`; по умолчанию значение — `anonymous`.

Список проектов доступен через `GET /api/v1/projects`.

```sh
curl -X POST http://localhost:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Мой проект","document":{"version":3,"units":"mm","elements":[],"connections":[]}}'
```

Получение и сохранение выполняются по возвращённому `id`:

```sh
curl http://localhost:8080/api/v1/projects/<id>
curl -X PUT http://localhost:8080/api/v1/projects/<id> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Мой проект","document":{"version":3,"units":"mm","elements":[],"connections":[]}}'
```

Проверка:

```sh
curl http://localhost:8080/health
```

Ответ: `{"status":"ok"}`.

Проверка соединения с PostgreSQL:

```sh
curl http://localhost:8080/health/db
```
