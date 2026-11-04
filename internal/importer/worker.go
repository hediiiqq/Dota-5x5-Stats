package importer

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, db *pgxpool.Pool) error {

	conn, err := postgres.AcquireImportWorkerLock(ctx, db)
	if err != nil {
		return err
	}

	defer func() {
		defer conn.Release()
		ctxX, cancelX := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelX()
		if closeErr := conn.Conn().Close(ctxX); closeErr != nil {
			log.Printf("Не удалось закрыть соединение блокировки исполнителя: %v", closeErr)
		}
	}()

	for {

		if err = ctx.Err(); err != nil {
			return err
		}

		job, err := postgres.ClaimImportJob(ctx, db)
		if err != nil {
			return err
		}

		if job == nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(3 * time.Second):
			}
			continue
		}

		var errMessage *string
		var errCode *string

		err = processJob(ctx, db, job)
		if err != nil {
			message := err.Error()
			code := "import_failed"

			errMessage = &message
			errCode = &code
		}

		ctxS, cancelS := context.WithTimeout(context.Background(), 5*time.Second)

		err = postgres.FinishImportJob(ctxS, db, job.Id, errCode, errMessage)
		cancelS()
		if err != nil {
			return err
		}

	}
}

func processJob(ctx context.Context, db *pgxpool.Pool, job *postgres.ImportJob) error {

	accounts := config.Load()
	var selectedAccount config.SteamAccount
	accountFound := false

	for _, account := range accounts {
		if account.ID != job.AccountId {
			continue
		}
		selectedAccount = account
		accountFound = true
		break
	}

	if !accountFound {
		return errors.New("steam-аккаунт для задания не найден")
	}
	var minMatchID uint64

	switch job.Mode {
	case "history":
		if job.MinMatchId == nil {
			return errors.New("не задан min_match_id")
		}
		minMatchID = *job.MinMatchId
	case "incremental":
		if job.AfterMatchId == nil {
			return errors.New("не задан after_match_id")
		}
		minMatchID = *job.AfterMatchId + 1

	default:
		return errors.New("неизвестный режим импорта")
	}

	checkMatch := func(ctx context.Context, matchId uint64) (bool, error) {
		ctxCH, cancelCH := context.WithTimeout(ctx, 5*time.Second)
		defer cancelCH()
		dbCheck, err := postgres.HasMatchMetadata(ctxCH, db, matchId)
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

	result, err := coordinator.RunAccount(ctx, selectedAccount, minMatchID, true, checkMatch, loadSyncState)
	if err != nil {
		return err
	}

	if result.HasError {
		return errors.New("история матчей загружена не полностью")
	}

	savefailed := false

	var lastMetadataStarted time.Time

	for _, match := range result.Matches {

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

		id, inserted, err1 := postgres.SaveMatchWithPlayers(ctx, db, match)
		if err1 != nil {
			log.Printf("Ошибка сохранения матча:%v , статус: %v, ошибка: %v", match.GetMatchId(), inserted, err1)
			savefailed = true
			continue
		}

		if !inserted {
			log.Printf("Матч уже существует id:%v, загружаем метаданные", match.GetMatchId())

		}

		if !lastMetadataStarted.IsZero() {
			delay := time.Until(lastMetadataStarted.Add(5 * time.Second))
			if delay > 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(delay):
				}
			}
		}

		lastMetadataStarted = time.Now()
		err = runMetadata(ctx, db, id, match)
		if err != nil {
			return err
		}

	}

	if savefailed {
		return errors.New("часть матчей не удалось обработать или сохранить")
	}

	if result.AccountId == 0 {
		return errors.New("нулевой аккаунт айди")
	}

	ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)
	defer cancelS()

	if result.LatestMatchId != 0 {
		err = postgres.SaveSyncState(ctxS, db, int64(result.AccountId), result.LatestMatchId)
		if err != nil {
			return err
		}
	}

	log.Printf("result %v", len(result.Matches))

	log.Printf("Аккаунт: %s, минимальный матч %v", selectedAccount.Name, minMatchID)
	return nil
}
