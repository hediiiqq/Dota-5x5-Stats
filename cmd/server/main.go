package main

import (
	"context"
	"dota-stats/internal/config"
	httpapi "dota-stats/internal/http"
	"dota-stats/internal/repository/postgres"
	"log"
	"net/http"
	"time"
)

func main() {

	dbString := config.DB()

	if dbString == "" {
		log.Fatal("Запуск HTTP-сервера невозможен: переменная DB_URL отсутствует или пуста")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := postgres.Open_DB(ctx, dbString)
	if err != nil {
		log.Fatalf("Не удалось подключиться к PostgreSQL для HTTP-сервера: %v", err)
	}
	defer db.Close()

	router := httpapi.NewRouter(db)

	log.Print("Запуск HTTP-сервера на адресе :8080 (все доступные сетевые интерфейсы)")

	server := &http.Server{Addr: ":8080", Handler: router, ReadTimeout: 5 * time.Second}

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("HTTP-сервер завершился с ошибкой: %v", err)
	}

}
