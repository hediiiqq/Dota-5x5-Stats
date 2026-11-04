package importer

import (
	"context"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/metadata"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/paralin/go-dota2/protocol"
	"github.com/pkg/errors"
)

func runMetadata(ctx context.Context, db *pgxpool.Pool, id int64, rawdata *protocol.CMsgDOTAMatch) error {

	matchId := rawdata.GetMatchId()
	cluster := rawdata.GetCluster()
	salt := rawdata.GetReplaySalt()

	if matchId == 0 {
		return errors.New("нулевой матч айди")
	}
	if cluster == 0 {
		return errors.New("пустой кластер")
	}
	if salt == 0 {
		return errors.New("нулевой салт")
	}

	metadataJSON, err := metadata.CheckMetadataContext(ctx, matchId, cluster, uint64(salt))

	if err != nil {

		log.Printf("ошибка проверки метадаты %v", err)
		return err
	}

	ctxS, cancelS := context.WithTimeout(ctx, 15*time.Second)
	defer cancelS()

	tx, err := db.Begin(ctxS)

	if err != nil {

		log.Printf("Ошибка обратотчика metadata, по id:%v , ошибка: %v", matchId, err)
		cancelS()
		return err
	}

	err = postgres.SaveMetadata(ctxS, tx, id, metadataJSON)

	if err != nil {

		log.Printf("Ошибка записи матадаты в бд, id матча: %v, ошибка:%v", matchId, err)
		rollbackErr := tx.Rollback(ctxS)
		if rollbackErr != nil {
			log.Println("Ошибка отмены транзакции")
			cancelS()
			return err
		}
		cancelS()
		return err
	}

	err = tx.Commit(ctxS)

	if err != nil {

		log.Printf("id %d: подтверждение транзакции завершилось ошибкой: %v", id, err)
		cancelS()
		return err
	}

	cancelS()

	log.Printf("Матч %v сохранен", id)
	return nil

}
