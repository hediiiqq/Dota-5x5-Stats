package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"log"
	"os"
	"time"
)

func main() {

	dbString := config.DB()

	if dbString == "" {
		log.Fatalln("db_url is empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := postgres.Open_DB(ctx, dbString)
	if err != nil {
		log.Fatalln(err)
	}
	defer db.Close()

	data, err := os.ReadFile("testdata/match.json")
	if err != nil {
		log.Printf("failed to read testdata/match.json: %s", err)
	}
	log.Printf("data: %s", string(data))

}
