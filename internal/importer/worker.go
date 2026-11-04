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
	"github.com/paralin/go-dota2/protocol"
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
			code, message := publicJobError(err)

			errMessage = &message
			errCode = &code
		}

		ctxS, cancelS := context.WithTimeout(context.Background(), 5*time.Second)

		err = postgres.FinishImportJob(ctxS, db, job.Id, errCode, errMessage)
		cancelS()
		if err != nil {
			return err
		}
		event := &postgres.ImportEvent{JobId: job.Id}
		if errMessage == nil {
			event.Level = "info"
			event.Message = "Задание успешно завершено"
		} else {
			event.Level = "error"
			event.Message = *errMessage
		}
		ctxX, cancelX := context.WithTimeout(context.Background(), 5*time.Second)

		if finished, found, summaryErr := postgres.GetImportJob(ctxX, db, job.Id); summaryErr == nil && found {
			event.Message += fmt.Sprintf(" Найдено: %d; сохранено: %d; уже в базе: %d; отфильтровано: %d; матчей с ошибками: %d.", finished.Discovered, finished.Saved, finished.Existing, finished.Filtered, finished.Failed)
		} else if summaryErr != nil {
			log.Printf("Задание %d: не удалось прочитать итоговые счётчики: %v", job.Id, summaryErr)
		}
		eventErr := postgres.CreateImportEvent(ctxX, db, event)
		cancelX()
		if eventErr != nil {
			log.Printf("ошибка создания евента %v", eventErr)
		}

		log.Printf("Задание %d: выполнение завершено", job.Id)

	}
}

func processJob(ctx context.Context, db *pgxpool.Pool, job *postgres.ImportJob) (resultErr error) {

	stage := "steam_connect"
	event := postgres.ImportEvent{
		JobId:   job.Id,
		Level:   "info",
		Message: "Начата обработка задания",
		Stage:   &stage,
	}

	ctxX, cancelX := context.WithTimeout(ctx, 5*time.Second)

	err := postgres.CreateImportEvent(ctxX, db, &event)
	cancelX()
	if err != nil {
		return err
	}

	report := func(ctx context.Context, p postgres.ImportProgress) error {
		return recordJobProgress(ctx, db, job.Id, p)
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
			if err := report(ctx, postgres.ImportProgress{Stage: p.Stage, Discovered: p.Discovered, Existing: p.Existing, Filtered: p.Filtered, Failed: p.Failed}); err != nil {
				return err
			}
			if p.Event != nil {
				event := postgres.ImportEvent{Level: p.Event.Level, Stage: &p.Event.Stage, Message: p.Event.Message}
				if p.Event.MatchID != 0 {
					event.DotaMatchId = &p.Event.MatchID
				}
				recordJobEvent(ctx, db, job.Id, event)
			}
			return nil
		})
	if err != nil {
		return err
	}

	return processResult(ctx, db, job, result, runMetadata)
}

func processResult(ctx context.Context, db *pgxpool.Pool, job *postgres.ImportJob, result coordinator.AccountResult,
	loadMetadata func(context.Context, *pgxpool.Pool, int64, *protocol.CMsgDOTAMatch) error) (resultErr error) {
	report := func(ctx context.Context, p postgres.ImportProgress) error {
		return recordJobProgress(ctx, db, job.Id, p)
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
			recordMatchProblem(ctx, db, job.Id, "saving", 0, "Матч не сохранён: отсутствует объект матча.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.MatchId == nil {
			log.Print("Импорт пропущен: в данных матча отсутствует ID Dota")
			recordMatchProblem(ctx, db, job.Id, "saving", 0, "Матч не сохранён: отсутствует Dota Match ID.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.Starttime == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует время начала", match.GetMatchId())
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Матч не сохранён: отсутствует время начала.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.Duration == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует длительность", match.GetMatchId())
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Матч не сохранён: отсутствует длительность.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.GameMode == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует режим игры", match.GetMatchId())
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Матч не сохранён: отсутствует режим игры.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.LobbyType == nil {
			log.Printf("Матч Dota %d пропущен: отсутствует тип лобби", match.GetMatchId())
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Матч не сохранён: отсутствует тип лобби.")
			savefailed = true
			failedMatches++
			continue
		}

		if match.GetMatchId() == 0 {
			log.Print("Импорт пропущен: ID матча Dota равен нулю")
			recordMatchProblem(ctx, db, job.Id, "saving", 0, "Матч не сохранён: Dota Match ID равен нулю.")
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
		var invalidReason string

		accId := make(map[uint32]bool)

		for _, player := range match.GetPlayers() {

			if player == nil {
				invalidReason = "В составе отсутствует объект игрока."
				log.Printf("Матч Dota %d: в списке игроков обнаружен отсутствующий объект", match.GetMatchId())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.AccountId == nil {
				invalidReason = "У игрока отсутствует ID аккаунта."
				log.Printf("Матч Dota %d: у игрока %q отсутствует ID аккаунта", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.GetAccountId() == 0 {
				invalidReason = "ID аккаунта игрока равен нулю."
				log.Printf("Матч Dota %d: у игрока %q ID аккаунта равен нулю", match.GetMatchId(), player.GetPlayerName())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if player.TeamNumber == nil {
				invalidReason = "У игрока отсутствует номер стороны."
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d отсутствует номер стороны", match.GetMatchId(), player.GetAccountId())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if *player.TeamNumber != 0 && *player.TeamNumber != 1 {
				invalidReason = "У игрока некорректный номер стороны."
				log.Printf("Матч Dota %d: у игрока с ID аккаунта %d неверный номер стороны %d; допустимы 0 и 1", match.GetMatchId(), player.GetAccountId(), player.GetTeamNumber())
				invalidPlayers = true
				savefailed = true
				failedMatches++
				break
			}

			if accId[player.GetAccountId()] {
				invalidReason = "ID аккаунта повторяется в составе игроков."
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
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Матч не сохранён. "+invalidReason)
			continue
		}

		id, inserted, err1 := postgres.SaveMatchWithPlayers(ctx, db, match)
		if err1 != nil {
			log.Printf("Ошибка сохранения матча:%v , статус: %v, ошибка: %v", match.GetMatchId(), inserted, err1)
			recordMatchProblem(ctx, db, job.Id, "saving", match.GetMatchId(), "Не удалось сохранить матч. "+eventFailureReason(err1))
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
		err := loadMetadata(ctx, db, id, match)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Printf("Задание %d: метаданные матча %d не загружены: %v", job.Id, match.GetMatchId(), err)
			recordMatchProblem(ctx, db, job.Id, "metadata", match.GetMatchId(), "Не удалось загрузить или сохранить метаданные. "+eventFailureReason(err))
			savefailed = true
			failedMatches++
			continue
		}

	}

	if savefailed || result.HasError {
		return &partialImportError{historyIncomplete: result.HistoryIncomplete, failedDetails: result.FailedDetails,
			firstFailedMatchID: result.FirstFailedMatchID, failedProcessing: failedMatches}
	}

	if result.AccountId == 0 {
		return errors.New("нулевой аккаунт айди")
	}

	ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)
	defer cancelS()

	if result.LatestMatchId != 0 {
		err := postgres.SaveSyncState(ctxS, db, int64(result.AccountId), result.LatestMatchId)
		if err != nil {
			return err
		}
	}

	log.Printf("result %v", len(result.Matches))

	log.Printf("Задание %d: аккаунт %s обработан", job.Id, job.AccountId)
	return nil
}
