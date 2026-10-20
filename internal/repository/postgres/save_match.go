package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/paralin/go-dota2/protocol"
)

func SaveMatchWithPlayers(ctx context.Context, db *pgxpool.Pool, match *protocol.CMsgDOTAMatch) (id int64, inserted bool, err error) {

	matchData, err := json.Marshal(match)

	if err != nil {
		log.Printf("Матч Dota %d пропущен: не удалось преобразовать данные в JSON: %v", match.GetMatchId(), err)
		return 0, false, err
	}

	ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)
	defer cancelS()

	tx, err := db.Begin(ctxS)
	if err != nil {
		log.Printf("Матч Dota %d: не удалось начать транзакцию сохранения: %v", match.GetMatchId(), err)
		return 0, false, err
	}

	defer func() {
		ctxC := context.Background()
		ctxq, cancelC := context.WithTimeout(ctxC, 5*time.Second)
		defer cancelC()
		rollbackErr := tx.Rollback(ctxq)
		if errors.Is(rollbackErr, pgx.ErrTxClosed) != true && rollbackErr != nil {
			log.Printf("Не удалось откатить транзакцию матча %v, ошибка:%v", match.GetMatchId(), rollbackErr)
		}
	}()

	internalID, inserted, err := SaveMatch(ctxS, tx, *match.MatchId, time.Unix(int64(match.GetStarttime()), 0), *match.Duration, *match.GameMode, *match.LobbyType, matchData)

	if err != nil {
		log.Printf("Матч Dota %d: ошибка записи матча; транзакция не подтверждена: %v", match.GetMatchId(), err)
		return 0, false, err
	}

	if !inserted {
		log.Printf("Матч Dota %d уже существует на момент вставки; повторная запись игроков пропущена", match.GetMatchId())
		return internalID, false, nil
	}

	err = SaveMatchPlayers(ctxS, tx, internalID, match.Players)
	if err != nil {
		log.Printf("Матч Dota %d: ошибка записи игроков; транзакция не подтверждена: %v", match.GetMatchId(), err)
		return 0, false, err
	}

	err = tx.Commit(ctxS)

	if err != nil {
		log.Printf("Матч Dota %d: подтверждение транзакции завершилось ошибкой: %v", match.GetMatchId(), err)
		return 0, false, err
	}

	log.Printf("Матч сохранён: ID Dota=%d, внутренний ID=%d, игроков=%d", match.GetMatchId(), internalID, len(match.Players))

	return internalID, true, nil

}
