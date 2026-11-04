package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"flag"
	"log"
	"sync"
	"time"

	"github.com/paralin/go-dota2/protocol"
)

func main() {

	minMatchId := flag.Uint64("min-match-id", 6000000000, "Нижняя граница ID матчей для загрузки истории")

	fullHistory := flag.Bool("full-history", false, "Загрузить историю до min-match-id, игнорируя сохранённую границу")

	flag.Parse()

	log.Printf("Режим поиска матчей  %v", *fullHistory)

	dbString := config.DB()
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)
	if err != nil {
		log.Fatalf("Не удалось подключиться к PostgreSQL для импорта: %v", err)
	}
	defer db.Close()
	// Serialize legacy CLI imports with the admin queue worker.
	lockCtx, cancelLock := context.WithTimeout(context.Background(), 5*time.Second)
	lock, err := postgres.AcquireImportWorkerLock(lockCtx, db)
	cancelLock()
	if err != nil {
		log.Printf("Импорт не запущен: %v", err)
		return
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lock.Conn().Close(closeCtx)
		lock.Release()
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	accounts := config.Load()
	wg := &sync.WaitGroup{}

	historyResult := make(chan coordinator.AccountResult, len(accounts))
	var allMatches []*protocol.CMsgDOTAMatch

	var accountResults []coordinator.AccountResult

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

	loadSyncState := func(ctx context.Context, accountId uint64) (uint64, bool, error) {
		ctxLO, cancelLO := context.WithTimeout(ctx, 5*time.Second)
		defer cancelLO()

		dbCheck, found, err := postgres.GetSyncState(ctxLO, db, int64(accountId))
		if err != nil {
			log.Printf("Не удалось получить последний сохраненный матч: %v", err)
		}
		return dbCheck, found, err
	}

	log.Printf("min match id: %v", *minMatchId)

	for _, account := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()

			result, err := coordinator.RunAccount(ctx, account, *minMatchId, *fullHistory, checkMatch, loadSyncState)

			if err != nil {
				log.Printf("Аккаунт %s: загрузка матчей прервана: %v", account.Name, err)
				return
			}
			historyResult <- result
			log.Printf("Аккаунт %s: получено подробных данных матчей — %d", account.Name, len(result.Matches))
		}()
	}
	wg.Wait()
	close(historyResult)

	savefailed := false

	for result := range historyResult {
		accountResults = append(accountResults, result)
		for _, match := range result.Matches {
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
			savefailed = true
			continue
		}

		if match.MatchId == nil {
			log.Print("Импорт пропущен: в данных матча отсутствует ID Dota")
			savefailed = true
			continue
		}

		if match.Starttime == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует время начала", match.GetMatchId())
			savefailed = true
			continue
		}

		if match.Duration == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует длительность", match.GetMatchId())
			savefailed = true
			continue
		}

		if match.GameMode == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует режим игры", match.GetMatchId())
			savefailed = true
			continue
		}

		if match.LobbyType == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует тип лобби", match.GetMatchId())
			savefailed = true
			continue
		}

		if match.GetMatchId() == 0 {
			log.Print("Импорт пропущен: ID матча Dota равен нулю")
			savefailed = true
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
				savefailed = true
				break
			}

			if player.AccountId == nil {
				log.Printf("Матч Dota %d: у игрока %q отсутствует ID аккаунта", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				break
			}

			if player.GetAccountId() == 0 {
				log.Printf("Матч Dota %d: у игрока %q ID аккаунта равен нулю", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				break
			}

			if player.TeamNumber == nil {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d отсутствует номер стороны", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				savefailed = true
				break
			}

			if *player.TeamNumber != 0 && *player.TeamNumber != 1 {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d неверный номер стороны %d; допустимы 0 и 1", match.GetMatchId(), player.GetAccountId(), player.GetTeamNumber())
				invalidPlayers = true
				savefailed = true
				break
			}

			if accId[player.GetAccountId()] {
				log.Printf("Матч Dota %d: ID аккаунта %d повторяется в составе игроков", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				savefailed = true
				break
			}
			accId[player.GetAccountId()] = true

		}

		if invalidPlayers {
			log.Printf("Матч Dota %d пропущен: некорректный состав игроков", match.GetMatchId())
			continue
		}

		_, inserted, err1 := postgres.SaveMatchWithPlayers(ctx, db, match)
		if err1 != nil {
			log.Printf("Ошибка сохранения матча:%v , статус: %v, ошибка: %v", match.GetMatchId(), inserted, err1)
			savefailed = true
			continue
		}

		if !inserted {
			log.Printf("Матч уже существует id:%v, пропуск", match.GetMatchId())
			continue
		}

	}

	if savefailed {
		log.Println("Прогресс синхронизации не обновлён: часть матчей не удалось обработать")
		return
	}

	for _, result := range accountResults {
		if result.HasError {
			log.Println("Прогресс аккаунта не обновлен из-за не полной загрузки матчей")
			continue
		}
		if result.AccountId == 0 || result.LatestMatchId == 0 {
			log.Println("Прогресс аккаунта не обновлен из-за пустого аккаунт айди или последнего айди матча")
			continue
		}
		ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)

		err = postgres.SaveSyncState(ctxS, db, int64(result.AccountId), result.LatestMatchId)
		cancelS()

		if err != nil {
			log.Printf("Ошибка сохранения последнего результата для аккаунта: %v, ошибка: %v", result.AccountId, err)
			continue
		}
		log.Printf("Прогресс синхронизации сохранён: ID аккаунта= %v, последний проверенный ID матча=%v", result.AccountId, result.LatestMatchId)
	}
}
