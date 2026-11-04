package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/importer"
	"dota-stats/internal/repository/postgres"
	"errors"
	"log"
	"os/signal"
	"syscall"
	"time"
)

func main() {

	dbString := config.DB()
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)
	if err != nil {
		log.Fatalf("Не удалось подключиться к PostgreSQL для импорта: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	ctxS, cancelS := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer cancelS()

	err = importer.Run(ctxS, db)

	if errors.Is(err, context.Canceled) {
		log.Printf("Исполнитель остановлен")
		return
	}
	if err != nil {
		log.Printf("ошибка %v", err)
	}
}
