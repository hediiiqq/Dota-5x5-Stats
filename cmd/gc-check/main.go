package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"encoding/json"
	"flag"
	"log"
	"sync"
	"time"

	"github.com/paralin/go-dota2/protocol"
)

func main() {

	minMatchId := flag.Uint64("min-match-id", 9000000000, "Нижняя граница ID матчей для загрузки истории")

	flag.Parse()

	dbString := config.DB()
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)
	if err != nil {
		log.Fatalf("Не удалось подключиться к PostgreSQL для импорта: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	accounts := config.Load()
	wg := &sync.WaitGroup{}

	historyResult := make(chan []*protocol.CMsgDOTAMatch, len(accounts))
	var allMatches []*protocol.CMsgDOTAMatch

	seen := make(map[uint64]bool)

	checkMatch := func(ctx context.Context, matchId uint64) (bool, error) {
		ctxCH, cancelCH := context.WithTimeout(ctx, 5*time.Second)
		defer cancelCH()
		dbCheck, err := postgres.CheckMatch(ctxCH, db, matchId)
		if err != nil {
			log.Printf("Матч Dota %d: не удалось проверить наличие в базе: %v", matchId, err)
		}
		return dbCheck, err
	}

	log.Printf("min match id: %v", *minMatchId)

	for _, account := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()

			matchIDs, err := coordinator.RunAccount(ctx, account, *minMatchId, checkMatch)

			if err != nil {
				log.Printf("Аккаунт %s: загрузка матчей прервана: %v", account.Name, err)
				return
			}
			historyResult <- matchIDs
			log.Printf("Аккаунт %s: получено подробных данных матчей — %d", account.Name, len(matchIDs))
		}()
	}
	wg.Wait()
	close(historyResult)

	for matches := range historyResult {
		for _, match := range matches {
			matchID := match.GetMatchId()
			if !seen[matchID] {
				seen[matchID] = true
				allMatches = append(allMatches, match)
			}
		}
	}
	log.Printf("После удаления повторов получено матчей для проверки и импорта: %d", len(allMatches))

	for _, match := range allMatches {

		if match == nil {
			log.Print("Импорт пропущен: объект матча отсутствует")
			continue
		}

		if match.MatchId == nil {
			log.Print("Импорт пропущен: в данных матча отсутствует ID Dota")
			continue
		}

		if match.Starttime == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует время начала", match.GetMatchId())
			continue
		}

		if match.Duration == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует длительность", match.GetMatchId())
			continue
		}

		if match.GameMode == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует режим игры", match.GetMatchId())
			continue
		}

		if match.LobbyType == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует тип лобби", match.GetMatchId())
			continue
		}

		if match.GetMatchId() == 0 {
			log.Print("Импорт пропущен: ID матча Dota равен нулю")
			continue
		}

		if len(match.GetPlayers()) != 10 {
			log.Printf("Матч Dota %d пропущен: ожидалось 10 игроков, получено %d", match.GetMatchId(), len(match.GetPlayers()))
			continue
		}

		var invalidPlayers bool = false

		accId := make(map[uint32]bool)

		for _, player := range match.GetPlayers() {

			if player == nil {
				log.Printf("Матч Dota %d: в списке игроков обнаружен отсутствующий объект", match.GetMatchId())
				invalidPlayers = true
				break
			}

			if player.AccountId == nil {
				log.Printf("Матч Dota %d: у игрока %q отсутствует ID аккаунта", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				break
			}

			if player.GetAccountId() == 0 {
				log.Printf("Матч Dota %d: у игрока %q ID аккаунта равен нулю", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				break
			}

			if player.TeamNumber == nil {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d отсутствует номер стороны", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				break
			}

			if *player.TeamNumber != 0 && *player.TeamNumber != 1 {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d неверный номер стороны %d; допустимы 0 и 1", match.GetMatchId(), player.GetAccountId(), player.GetTeamNumber())
				invalidPlayers = true
				break
			}

			if accId[player.GetAccountId()] {
				log.Printf("Матч Dota %d: ID аккаунта %d повторяется в составе игроков", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				break
			}
			accId[player.GetAccountId()] = true

		}

		if invalidPlayers {
			log.Printf("Матч Dota %d пропущен: некорректный состав игроков", match.GetMatchId())
			continue
		}

		matchData, err := json.Marshal(match)

		if err != nil {
			log.Printf("Матч Dota %d пропущен: не удалось преобразовать данные в JSON: %v", match.GetMatchId(), err)
			continue
		}

		ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)

		checkMatch, err := postgres.CheckMatch(ctxS, db, match.GetMatchId())

		if err != nil {
			log.Printf("Матч Dota %d пропущен: не удалось проверить наличие в базе: %v", match.GetMatchId(), err)
			cancelS()
			continue
		}
		if checkMatch == true {
			log.Printf("Матч Dota %d уже сохранён в базе; повторный импорт пропущен", match.GetMatchId())
			cancelS()
			continue
		}
		tx, err := db.Begin(ctxS)
		if err != nil {
			log.Printf("Матч Dota %d: не удалось начать транзакцию сохранения: %v", match.GetMatchId(), err)
			cancelS()
			continue
		}

		internalID, inserted, err := postgres.SaveMatch(ctxS, tx, *match.MatchId, time.Unix(int64(match.GetStarttime()), 0), *match.Duration, *match.GameMode, *match.LobbyType, matchData)

		if err != nil {
			log.Printf("Матч Dota %d: ошибка записи матча; транзакция не подтверждена: %v", match.GetMatchId(), err)
			tx.Rollback(ctxS)
			cancelS()
			continue
		}
		if !inserted {
			log.Printf("Матч Dota %d уже существует на момент вставки; повторная запись игроков пропущена", match.GetMatchId())
			tx.Rollback(ctxS)
			cancelS()
			continue
		}

		err = postgres.SaveMatchPlayers(ctxS, tx, internalID, match.Players)
		if err != nil {
			log.Printf("Матч Dota %d: ошибка записи игроков; транзакция не подтверждена: %v", match.GetMatchId(), err)
			tx.Rollback(ctxS)
			cancelS()
			continue
		}
		err = tx.Commit(ctxS)
		if err != nil {
			log.Printf("Матч Dota %d: подтверждение транзакции завершилось ошибкой: %v", match.GetMatchId(), err)
			tx.Rollback(ctxS)
			cancelS()
			continue
		}
		log.Printf("Матч сохранён: ID Dota=%d, внутренний ID=%d, игроков=%d", match.GetMatchId(), internalID, len(match.Players))
		cancelS()
	}
}
