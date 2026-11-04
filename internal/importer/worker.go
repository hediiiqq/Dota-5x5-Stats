package importer

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, db *pgxpool.Pool) error {
	return run(ctx, db, processJob)
}

func run(ctx context.Context, db *pgxpool.Pool, process func(context.Context, *pgxpool.Pool, *postgres.ImportJob) error) error {

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

	// Loss of this session releases the exclusive lock. Stop processing rather
	// than allowing a second worker to share the Steam accounts.
	ctx, cancel := context.WithCancel(ctx)
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pingCtx, stop := context.WithTimeout(ctx, 5*time.Second)
				pingErr := conn.Conn().Ping(pingCtx)
				stop()
				if pingErr != nil {
					log.Printf("Соединение блокировки потеряно: %v", pingErr)
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-watchDone }()
	recoverCtx, stopRecover := context.WithTimeout(ctx, 5*time.Second)
	err = postgres.RecoverImportJobs(recoverCtx, db)
	stopRecover()
	if err != nil {
		return err
	}
	log.Print("Исполнитель импорта запущен, ожидается очередь заданий")

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

		log.Printf("Задание %d: начало импорта аккаунта %s", job.Id, job.AccountId)
		err = process(ctx, db, job)
		if err != nil {
			log.Printf("Задание %d: %v", job.Id, err)
			message := "Не удалось завершить импорт. Подробности в журнале исполнителя."
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
		log.Printf("Задание %d: выполнение завершено", job.Id)

	}
}

func processJob(ctx context.Context, db *pgxpool.Pool, job *postgres.ImportJob) (resultErr error) {
	report := func(ctx context.Context, p postgres.ImportProgress) error {
		updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return postgres.AddImportProgress(updateCtx, db, job.Id, p)
	}

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
		if err := postgres.BindImportAccount(ctxLO, db, job.AccountId, accountId); err != nil {
			return 0, false, err
		}

		dbCheck, found, err := postgres.GetSyncState(ctxLO, db, int64(accountId))
		if err != nil {
			log.Printf("Не удалось получить последний сохраненный матч: %v", err)
		}
		return dbCheck, found, err
	}

	result, err := coordinator.RunAccount(ctx, selectedAccount, minMatchID, true, checkMatch, loadSyncState,
		func(ctx context.Context, p coordinator.Progress) error {
			return report(ctx, postgres.ImportProgress{Stage: p.Stage, Discovered: p.Discovered, Existing: p.Existing, Filtered: p.Filtered, Failed: p.Failed})
		})
	if err != nil {
		return err
	}

	if result.HasError {
		return errors.New("история матчей загружена не полностью")
	}

	var failedMatches int64
	defer func() {
		if failedMatches == 0 {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := report(cleanupCtx, postgres.ImportProgress{Failed: failedMatches}); err != nil {
			resultErr = errors.Join(resultErr, err)
		}
	}()
	savefailed := false
	if err := report(ctx, postgres.ImportProgress{Stage: "saving"}); err != nil {
		return err
	}

	var lastMetadataStarted time.Time

	for _, match := range result.Matches {

		if match == nil {
			log.Print("Импорт пропущен: объект матча отсутствует")
			savefailed = true
			failedMatches++
			continue
		}

		if match.MatchId == nil {
			log.Print("Импорт пропущен: в данных матча отсутствует ID Dota")
			savefailed = true
			failedMatches++
			continue
		}

		if match.Starttime == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует время начала", match.GetMatchId())
			savefailed = true
			failedMatches++
			continue
		}

		if match.Duration == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует длительность", match.GetMatchId())
			savefailed = true
			failedMatches++
			continue
		}

		if match.GameMode == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует режим игры", match.GetMatchId())
			savefailed = true
			failedMatches++
			continue
		}

		if match.LobbyType == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует тип лобби", match.GetMatchId())
			savefailed = true
			failedMatches++
			continue
		}

		if match.GetMatchId() == 0 {
			log.Print("Импорт пропущен: ID матча Dota равен нулю")
			savefailed = true
			failedMatches++
			continue
		}

		if len(match.GetPlayers()) != 10 {
			log.Printf("Матч Dota %d пропущен: ожидалось 10 игроков, получено %d", match.GetMatchId(), len(match.GetPlayers()))
			if err := report(ctx, postgres.ImportProgress{Filtered: 1}); err != nil {
				return err
			}
			continue
		}

		var invalidPlayers bool = false

		accId := make(map[uint32]bool)

		for _, player := range match.GetPlayers() {

			if player == nil {
				log.Printf("Матч Dota %d: в списке игроков обнаружен отсутствующий объект", match.GetMatchId())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.AccountId == nil {
				log.Printf("Матч Dota %d: у игрока %q отсутствует ID аккаунта", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.GetAccountId() == 0 {
				log.Printf("Матч Dota %d: у игрока %q ID аккаунта равен нулю", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.TeamNumber == nil {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d отсутствует номер стороны", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if *player.TeamNumber != 0 && *player.TeamNumber != 1 {
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d неверный номер стороны %d; допустимы 0 и 1", match.GetMatchId(), player.GetAccountId(), player.GetTeamNumber())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if accId[player.GetAccountId()] {
				log.Printf("Матч Dota %d: ID аккаунта %d повторяется в составе игроков", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				savefailed = true
				failedMatches++
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
			failedMatches++
			continue
		}

		if !inserted {
			log.Printf("Матч уже существует id:%v, загружаем метаданные", match.GetMatchId())

		}
		p := postgres.ImportProgress{Saved: 1}
		if !inserted {
			p = postgres.ImportProgress{Existing: 1}
		}
		if err := report(ctx, p); err != nil {
			return err
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
			if updateErr := report(ctx, postgres.ImportProgress{Failed: 1}); updateErr != nil {
				return errors.Join(err, updateErr)
			}
			return fmt.Errorf("метаданные матча %d: %w", match.GetMatchId(), err)
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
