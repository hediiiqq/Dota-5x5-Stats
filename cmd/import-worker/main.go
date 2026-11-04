package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/importer"
	"dota-stats/internal/repository/postgres"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		log.Printf("Исполнитель импорта завершился с ошибкой: %v", err)
		os.Exit(1)
	}
}

func run() error {

	dbString := config.DB()
	if dbString == "" {
		return errors.New("DB_URL отсутствует или пуста")
	}
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)
	if err != nil {
		return err
	}
	defer db.Close()

	ctx := context.Background()

	ctxS, cancelS := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer cancelS()

	err = importer.Run(ctxS, db)

	if errors.Is(err, context.Canceled) {
		log.Printf("Исполнитель остановлен")
		return nil
	}
	return err
}
