package coordinator

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/paralin/go-dota2"
	"github.com/paralin/go-dota2/events"
	"github.com/paralin/go-dota2/protocol"
	"github.com/paralin/go-steam"
	"github.com/paralin/go-steam/protocol/protobuf/unified"
	"github.com/paralin/go-steam/protocol/steamlang"
	"github.com/sirupsen/logrus"

	"dota-stats/internal/config"
)

type AccountResult struct {
	Matches            []*protocol.CMsgDOTAMatch
	AccountId          uint64
	LatestMatchId      uint64
	HasError           bool
	HistoryIncomplete  bool
	FailedDetails      int64
	FirstFailedMatchID uint64
	err                error
}

func RunAccount(ctx context.Context, account config.SteamAccount, minAllowedMatchID uint64, fullHistory bool,
	checkMatch func(ctx context.Context, uint65 uint64) (bool, error),
	loadSyncState func(ctx context.Context, id uint64) (uint64, bool, error),
	observers ...func(context.Context, Progress) error) (AccountResult, error) {

	historyResult := make(chan AccountResult, 1)

	accountCtx, accountCancel := context.WithTimeout(ctx, 15*time.Minute)
	defer accountCancel()
	steamLoginInfo := new(steam.LogOnDetails)
	steamLoginInfo.Username = account.Login
	steamLoginInfo.Password = account.Pass
	steamLoginInfo.DeviceFriendlyName = "Dota 5x5 stats"
	steamLoginInfo.ConfirmSteamGuard = func(
		ctx context.Context,
		confirmations []steam.SteamGuardConfirmation,
	) (string, unified.EAuthSessionGuardType, error) {
		for _, confirmation := range confirmations {
			if confirmation.Type == unified.EAuthSessionGuardType_k_EAuthSessionGuardType_DeviceConfirmation {
				if err := reportProgress(ctx, Progress{Stage: "awaiting_guard"}, observers); err != nil {
					return "", 0, err
				}
				log.Printf("Аккаунт %s: подтвердите вход в мобильном приложении Steam", account.Name)
				return "", confirmation.Type, nil
			}
		}
		return "", 0, fmt.Errorf("аккаунт %s: Steam не предложил подтверждение входа через мобильное приложение", account.Name)
	}
	steamLoginInfo.ShouldRememberPassword = true

	if file, err := os.ReadFile(account.Token); err == nil {
		steamLoginInfo.AccessToken = string(bytes.TrimSpace(file))
	} else if os.IsNotExist(err) == true {
		log.Printf("Аккаунт %s: файл токена %q не найден; потребуется аутентификация", account.Name, account.Token)
	} else {
		log.Printf("Аккаунт %s: не удалось прочитать файл токена %q: %v", account.Name, account.Token, err)
	}

	client := steam.NewClient()
	defer client.Disconnect()
	dota := dota2.New(client, logrus.New())
	defer dota.Close()

	if _, err := client.ConnectContext(accountCtx); err != nil {
		log.Printf("Аккаунт %s: не удалось установить соединение со Steam: %v", account.Name, err)
		return AccountResult{}, err
	}

	helloTicker := time.NewTicker(5 * time.Second)
	defer helloTicker.Stop()

	loggedIn := false
	gcReady := false

	var matches []*protocol.CMsgDOTAMatch

	for {
		select {
		case event := <-client.Events():
			switch event := event.(type) {
			case *steam.ConnectedEvent:
				log.Printf("Аккаунт %s: соединение со Steam установлено; вход ещё не завершён", account.Name)
				go func() {
					authCtx, authCancel := context.WithTimeout(accountCtx, 180*time.Second)
					defer authCancel()
					if steamLoginInfo.AccessToken == "" {
						token, err := client.Auth.Authenticate(authCtx, steamLoginInfo)
						if err != nil {
							log.Printf("Аккаунт %s: не удалось пройти аутентификацию Steam: %v", account.Name, err)
							historyResult <- AccountResult{err: err}
							return
						}
						steamLoginInfo.AccessToken = token
						err = os.WriteFile(account.Token, []byte(token), 0600)
						if err != nil {
							log.Printf("Аккаунт %s: не удалось сохранить токен в файл %q: %v", account.Name, account.Token, err)

						}

					}

					if err := client.Auth.LogOn(authCtx, steamLoginInfo); err != nil {
						log.Printf("Аккаунт %s: не удалось выполнить вход в Steam: %v", account.Name, err)
						historyResult <- AccountResult{err: err}
						return
					}
				}()
			case *steam.LoggedOnEvent:
				if event.Result == steamlang.EResult_OK {
					log.Printf("Аккаунт %s: вход в Steam выполнен", account.Name)
					loggedIn = true
					if err := reportProgress(accountCtx, Progress{Stage: "gc_connect"}, observers); err != nil {
						return AccountResult{}, err
					}
					dota.SetPlaying(true)
					dota.SayHello()
					log.Printf("Аккаунт %s: отправлено приветствие координатору Dota 2", account.Name)
				} else {
					log.Printf("Аккаунт %s: Steam отклонил вход; результат=%v", account.Name, event.Result)
					return AccountResult{}, fmt.Errorf("аккаунт %s: Steam отклонил вход; результат=%v", account.Name, event.Result)

				}
			case *steam.LogOnFailedEvent:
				log.Printf("Аккаунт %s: вход в Steam завершился ошибкой; результат=%v, состояние сессии аутентификации=%v, причина=%v", account.Name, event.Result, event.AuthSessionState, event.Err)
				accountCancel()
				return AccountResult{}, fmt.Errorf(
					"вход в Steam завершился ошибкой: результат=%v, причина=%v, аккаунт=%s",
					event.Result,
					event.Err,
					account.Name,
				)
			case *steam.DisconnectedEvent:
				log.Printf("Аккаунт %s: соединение со Steam закрыто", account.Name)
				return AccountResult{}, fmt.Errorf(
					"аккаунт %s: соединение со Steam закрыто до завершения загрузки матчей",
					account.Name,
				)
			case *events.ClientWelcomed:
				if gcReady == true {
					continue
				} else {
					accountId := client.SteamId().GetAccountId()
					go func() {
						lastMatchId, found, err := loadSyncState(accountCtx, uint64(accountId))

						historyMinID := minAllowedMatchID
						if err != nil {
							log.Printf("ошибка на аккаунте %v: %v", account.Name, err)
							historyResult <- AccountResult{err: err}
							return
						}
						if !found {
							log.Printf("Последний матч не найден в бд на аккаунте %v", account.Name)

						}
						if found && !fullHistory {
							historyMinID = lastMatchId
							log.Printf("Аккаунт: %v,Id: %v ,загрузка истории до нижней границы %v , источник границы - бд", account.Name, accountId, historyMinID)
						} else {
							log.Printf("Аккаунт: %v,Id: %v ,загрузка истории до нижней границы %v , источник границы - флаг", account.Name, accountId, historyMinID)
						}

						if err := reportProgress(accountCtx, Progress{Stage: "history"}, observers); err != nil {
							historyResult <- AccountResult{err: err}
							return
						}
						matchIDs, latestMatchId, complete, err := HistoryDota(accountCtx, dota, &accountId, historyMinID, observers...)
						if err != nil {
							log.Printf("Аккаунт %s: не удалось получить историю матчей Dota 2: %v", account.Name, err)
							historyResult <- AccountResult{err: err}
							return
						}

						hasErrors := !complete
						var failedDetails int64
						var firstFailedMatchID uint64
						if err := reportProgress(accountCtx, Progress{Stage: "details"}, observers); err != nil {
							historyResult <- AccountResult{err: err}
							return
						}

						for _, matchID := range matchIDs {
							check, err := checkMatch(accountCtx, matchID)
							if err != nil {
								log.Printf("Аккаунт %s: матч Dota %d пропущен — не удалось проверить наличие в базе: %v", account.Name, matchID, err)
								historyResult <- AccountResult{err: err}
								return
							}
							if check == true {
								if err := reportProgress(accountCtx, Progress{Existing: 1}, observers); err != nil {
									historyResult <- AccountResult{err: err}
									return
								}
								log.Printf("Аккаунт %s: матч Dota %d уже сохранён; запрос подробностей пропущен", account.Name, matchID)
								continue
							}
							match, err := MatchDetails(accountCtx, dota, matchID)
							if err != nil {
								log.Printf("Аккаунт %s: не удалось получить подробности матча Dota %d: %v", account.Name, matchID, err)
								failedDetails++
								if firstFailedMatchID == 0 {
									firstFailedMatchID = matchID
								}
								if reportErr := reportProgress(accountCtx, detailsFailureProgress(matchID, err), observers); reportErr != nil {
									historyResult <- AccountResult{err: reportErr}
									return
								}
								hasErrors = true
								continue
							}
							matches = append(matches, match)
							log.Printf("Аккаунт %s: получены подробности матча Dota %d; запись в базу ещё не выполнена", account.Name, match.GetMatchId())

						}
						historyResult <- AccountResult{Matches: matches, err: err, AccountId: uint64(accountId), LatestMatchId: latestMatchId, HasError: hasErrors,
							HistoryIncomplete: !complete, FailedDetails: failedDetails, FirstFailedMatchID: firstFailedMatchID}
					}()
					gcReady = true
					helloTicker.Stop()
					log.Printf("Аккаунт %s: получено приветствие координатора Dota 2; запущена загрузка истории", account.Name)
				}
			case *events.GCConnectionStatusChanged:
				log.Printf("Аккаунт %s: изменилось состояние соединения с координатором Dota 2: %v", account.Name, event.NewState)

			case *steam.PlayingSessionStateEvent:
				if event.PlayingBlocked == true {
					log.Printf("Аккаунт %s: загрузка матчей прервана — игровая сессия занята; ID приложения=%v", account.Name, event.PlayingApp)
					accountCancel()
					return AccountResult{}, fmt.Errorf(
						"аккаунт %s: игровая сессия занята",
						account.Name,
					)
				}

			case error:
				log.Printf("Аккаунт %s: получено событие ошибки Steam: %v", account.Name, event)
				return AccountResult{}, event

			}
		case result := <-historyResult:
			return result, result.err
		case <-accountCtx.Done():
			log.Printf("Аккаунт %s: работа остановлена контекстом: %v", account.Name, accountCtx.Err())
			return AccountResult{}, accountCtx.Err()
		case <-helloTicker.C:
			if loggedIn && !gcReady {
				dota.SayHello()
				log.Printf("Аккаунт %s: повторно отправлено приветствие координатору Dota 2; ожидается ответ", account.Name)
			}

		}
	}

}
