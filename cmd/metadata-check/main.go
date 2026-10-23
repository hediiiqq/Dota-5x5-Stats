package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/metadata"
	"encoding/json"
	"log"
	"time"

	"github.com/paralin/go-dota2/protocol"
)

func main() {

	limit := 10
	offset := 0
	var processed, saved, failed int
	var lastRequestStarted time.Time

	ctx := context.Background()

	dbString := config.DB()
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)

	if err != nil {
		log.Fatalf("Не удалось подключиться к PostgreSQL для импорта: %v", err)
	}
	defer db.Close()

	for {
		dataS, err := postgres.ListMatches(ctx, db, limit, offset)
		if err != nil {
			log.Printf("Ошибка чтения матчей: %v", err)
			return
		}

		if len(dataS) == 0 {
			log.Printf("Обход всех матчей завершён. Просмотрено: %d, сохранено: %d, с ошибкой: %d", processed, saved, failed)
			return
		}

		for _, data := range dataS {
			processed++

			rawdata := data.RawData

			var jsondata protocol.CMsgDOTAMatch

			err = json.Unmarshal(rawdata, &jsondata)

			if err != nil {
				failed++
				log.Printf("Ошибка разбора json файла , id в бд: %v, ошибка: %v", data.ID, err)
				continue
			}

			matchId := jsondata.GetMatchId()
			cluster := jsondata.GetCluster()
			salt := jsondata.GetReplaySalt()

			if !lastRequestStarted.IsZero() {
				time.Sleep(time.Until(lastRequestStarted.Add(5 * time.Second)))
			}
			lastRequestStarted = time.Now()
			rawdata, err = metadata.CheckMetadata(matchId, cluster, uint64(salt))

			if err != nil {
				failed++
				log.Printf("ошибка проверки метадаты %v", err)
				continue
			}

			ctxS, cancelS := context.WithTimeout(ctx, 15*time.Second)

			tx, err := db.Begin(ctxS)

			if err != nil {
				failed++
				log.Printf("Ошибка обратотчика metadata, по id:%v , ошибка: %v", matchId, err)
				cancelS()
				continue
			}

			err = postgres.SaveMetadata(ctxS, tx, int64(data.ID), rawdata)

			if err != nil {
				failed++
				log.Printf("Ошибка записи матадаты в бд, id матча: %v, ошибка:%v", matchId, err)
				err := tx.Rollback(ctxS)
				if err != nil {
					log.Println("Ошибка отмены транзакции")
					cancelS()
					continue
				}
				cancelS()
				continue
			}

			err = tx.Commit(ctxS)

			if err != nil {
				failed++
				log.Printf("id %d: подтверждение транзакции завершилось ошибкой: %v", data.ID, err)
				cancelS()
				continue
			}

			cancelS()
			saved++
			log.Printf("Матч %v сохранен", data.ID)

		}

		offset += 10
	}

}
