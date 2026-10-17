package postgres

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open_DB(ctx context.Context, dbUrl string) (*pgxpool.Pool, error) {

	dbpool, err := pgxpool.New(ctx, dbUrl)
	if err != nil {
		log.Printf("Не удалось создать пул соединений: %v", err)
		return nil, err
	}

	err = dbpool.Ping(ctx)
	if err != nil {
		log.Printf("Не удалось достучаться до базы данных: %v\n", err)
		dbpool.Close()
		return nil, err
	}
	log.Println("Успешное подключение к PostgreSQL")
	return dbpool, err
}
