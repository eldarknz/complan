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

Проверка:

```sh
curl http://localhost:8080/health
```

Ответ: `{"status":"ok"}`.
