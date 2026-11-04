package coordinator

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/paralin/go-dota2"
	"github.com/paralin/go-dota2/protocol"
)

func HistoryDota(ctx context.Context, dota *dota2.Dota2, accountID *uint32, minAllowedMatchID uint64, observers ...func(context.Context, Progress) error) ([]uint64, uint64, bool, error) {

	var startAtMatchID uint64

	var latestMatchID uint64

	var complete bool = false

	var ReqMatches uint32 = 20
	var PracticeMatches bool = true
	matchIDs := make([]uint64, 0)

	seen := make(map[uint64]bool)
	discovered := make(map[uint64]bool)

	request := protocol.CMsgDOTAGetPlayerMatchHistory{
		AccountId:              accountID,
		MatchesRequested:       &ReqMatches,
		IncludePracticeMatches: &PracticeMatches,
		StartAtMatchId:         &startAtMatchID,
	}

	emptyAttempts := 0
	var delay time.Duration
	for {
		select {
		case <-ctx.Done():
			return nil, 0, complete, ctx.Err()
		case <-time.After(delay):
		}
		log.Printf("Аккаунт с ID %d: запрос страницы истории; курсор=%d, попытка получить непустую страницу=%d из 3", *accountID, startAtMatchID, emptyAttempts+1)
		started := time.Now()
		answer, err := dota.GetPlayerMatchHistory(ctx, &request)
		if err != nil {
			log.Printf("Аккаунт с ID %d: не удалось получить страницу истории с курсором %d: %v", *accountID, startAtMatchID, err)
			return nil, 0, complete, err
		}
		log.Printf("Аккаунт с ID %d: получена страница истории; курсор=%d, время запроса=%s, записей до фильтрации=%d", *accountID, startAtMatchID, time.Since(started).Round(time.Millisecond), len(answer.Matches))
		if len(answer.Matches) == 0 {
			emptyAttempts++
			if emptyAttempts < 3 {
				log.Printf("Аккаунт с ID %d: получена пустая страница с курсором %d; повторный запрос через 5 секунд", *accountID, startAtMatchID)
				delay = 5 * time.Second
				continue
			}
			log.Printf("Аккаунт с ID %d: загрузка истории остановлена после трёх пустых ответов подряд; курсор=%d", *accountID, startAtMatchID)
			if err := reportProgress(ctx, Progress{Event: &Event{Level: "warning", Stage: "history", Message: fmt.Sprintf("Обход истории остановлен после трёх пустых ответов подряд. Курсор: %d; запрошенная нижняя граница: %d.", startAtMatchID, minAllowedMatchID)}}, observers); err != nil {
				return nil, 0, false, err
			}
			break
		}
		emptyAttempts = 0
		delay = 2 * time.Second

		var minMatchID uint64 = 0

		for _, match := range answer.Matches {

			if match == nil {
				log.Printf("Аккаунт с ID %d: при поиске следующего курсора пропущена отсутствующая запись истории", *accountID)
				continue
			}

			if match.GetMatchId() == 0 {
				log.Printf("Аккаунт с ID %d: при поиске следующего курсора пропущена запись без ненулевого ID матча Dota", *accountID)
				continue
			}

			if minMatchID == 0 || match.GetMatchId() < minMatchID {

				minMatchID = match.GetMatchId()
			}
			if match.GetMatchId() > latestMatchID {
				latestMatchID = match.GetMatchId()
			}

		}
		log.Printf("Аккаунт с ID %d: обработана страница с курсором %d; минимальный ненулевой ID матча Dota=%d (0 — подходящих ID нет)", *accountID, startAtMatchID, minMatchID)

		pageProgress := Progress{}
		for idx, match := range answer.Matches {

			if match == nil {
				log.Printf("Аккаунт с ID %d: при отборе матчей пропущена отсутствующая запись истории", *accountID)
				continue
			}

			id := match.GetMatchId()
			if id != 0 && id >= minAllowedMatchID && !discovered[id] {
				discovered[id] = true
				pageProgress.Discovered++
				if match.LobbyType == nil || match.GetLobbyType() != 1 || (match.GetGameMode() != 16 && match.GetGameMode() != 2) {
					pageProgress.Filtered++
				}
			}
			if match.LobbyType != nil && match.GetLobbyType() == 1 && (match.GetGameMode() == 16 || match.GetGameMode() == 2) {
				log.Printf("Запись истории с индексом %d соответствует фильтру лобби и режима: режим=%v, ID аккаунта=%d, тип лобби=%d, ID матча Dota=%d; остальные проверки ещё не выполнены", idx, match.GetGameMode(), *accountID, match.GetLobbyType(), match.GetMatchId())

				if match.GetMatchId() < minAllowedMatchID {
					log.Printf("Аккаунт с ID %d: матч Dota %d пропущен — ID меньше нижней границы %d", *accountID, match.GetMatchId(), minAllowedMatchID)
					continue
				}

				if match.MatchId == nil {
					log.Printf("Аккаунт с ID %d: пропущена запись истории без ID матча Dota", *accountID)
					continue
				}
				if match.GetMatchId() == 0 {
					log.Printf("Аккаунт с ID %d: пропущена запись истории с нулевым ID матча Dota", *accountID)
					continue
				}
				id := match.GetMatchId()

				if seen[id] {
					log.Printf("Аккаунт с ID %d: повторная запись матча Dota %d пропущена", *accountID, id)
					continue
				}
				seen[id] = true
				matchIDs = append(matchIDs, id)
			}

		}

		if err := reportProgress(ctx, pageProgress, observers); err != nil {
			return nil, 0, false, err
		}
		if minMatchID == 0 {
			log.Printf("Аккаунт с ID %d: загрузка истории остановлена — на странице нет ненулевых ID матчей Dota", *accountID)
			if err := reportProgress(ctx, Progress{Event: &Event{Level: "warning", Stage: "history", Message: "Обход истории остановлен: на странице нет записей с ненулевым ID матча."}}, observers); err != nil {
				return nil, 0, false, err
			}
			break
		}
		if minMatchID <= minAllowedMatchID {
			log.Printf("Аккаунт с ID %d: загрузка истории остановлена — достигнута нижняя граница %d; минимальный ID матча на странице=%d", *accountID, minAllowedMatchID, minMatchID)
			complete = true
			break
		}
		if startAtMatchID != 0 && minMatchID >= startAtMatchID {
			log.Printf("Аккаунт с ID %d: загрузка истории остановлена — курсор не продвинулся к более старым матчам; текущий курсор=%d, минимальный ID на странице=%d", *accountID, startAtMatchID, minMatchID)
			if err := reportProgress(ctx, Progress{Event: &Event{Level: "warning", Stage: "history", Message: fmt.Sprintf("Обход истории остановлен: курсор не продвигается. Текущий курсор: %d; минимальный ID на странице: %d.", startAtMatchID, minMatchID)}}, observers); err != nil {
				return nil, 0, false, err
			}
			break
		} else {
			startAtMatchID = minMatchID

		}
	}

	return matchIDs, latestMatchID, complete, nil
}

type MatchDetailsError struct {
	MatchID uint64
	Result  uint32
}

func (e *MatchDetailsError) Error() string {
	return fmt.Sprintf("координатор Dota 2 не вернул объект матча %d; код результата=%d", e.MatchID, e.Result)
}

func MatchDetails(ctx context.Context, dota *dota2.Dota2, matchID uint64) (*protocol.CMsgDOTAMatch, error) {
	answer, err := dota.RequestMatchDetails(ctx, matchID)
	if err != nil {
		return nil, err
	}

	if answer.GetMatch() == nil {
		return nil, &MatchDetailsError{MatchID: matchID, Result: uint32(answer.GetResult())}
	}

	return answer.GetMatch(), nil
}
