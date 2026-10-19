package postgres

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open_DB(ctx context.Context, dbUrl string) (*pgxpool.Pool, error) {

	dbpool, err := pgxpool.New(ctx, dbUrl)
	if err != nil {
		log.Printf("Не удалось создать пул соединений с PostgreSQL: %v", err)
		return nil, err
	}

	err = dbpool.Ping(ctx)
	if err != nil {
		log.Printf("Не удалось проверить соединение с PostgreSQL: %v", err)
		dbpool.Close()
		return nil, err
	}
	log.Println("Успешное подключение к PostgreSQL")
	return dbpool, err
}
