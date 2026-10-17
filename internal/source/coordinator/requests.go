package coordinator

import (
	"context"
	"fmt"
	"log"

	"github.com/paralin/go-dota2"
	"github.com/paralin/go-dota2/protocol"
)

func HistoryDota(ctx context.Context, dota *dota2.Dota2, accountID *uint32) ([]uint64, error) {

	var ReqMatches uint32 = 20
	var PracticeMatches bool = true

	request := protocol.CMsgDOTAGetPlayerMatchHistory{
		AccountId:              accountID,
		MatchesRequested:       &ReqMatches,
		IncludePracticeMatches: &PracticeMatches,
	}

	//var startAtMatchID uint64 = 0

	answer, err := dota.GetPlayerMatchHistory(ctx, &request)
	if err != nil {
		log.Printf("Error getting match history: %v", err)
		return nil, err
	}
	log.Printf("Match history: %v", len(answer.Matches))

	var minMatchID uint64 = 0

	for _, match := range answer.Matches {
		if *match.MatchId == minMatchID && *match.MatchId == 0 {
			continue
		}
		if minMatchID == 0 || *match.MatchId < minMatchID {
			minMatchID = *match.MatchId
		}

	}
	log.Printf("min match id : %v", minMatchID)

	matchIDs := make([]uint64, 0)

	for idx, match := range answer.Matches {

		if match.LobbyType != nil && match.GetLobbyType() == 1 && (match.GetGameMode() == 16 || match.GetGameMode() == 2) {
			log.Printf("id: %v, gameMode:%v, acc: %v, lobby type: %v, matchid: %v", idx, match.GetGameMode(), *accountID, match.GetLobbyType(), match.GetMatchId())
			if match.MatchId != nil && match.GetMatchId() != 0 {
				matchIDs = append(matchIDs, match.GetMatchId())
			}
		}

	}
	return matchIDs, nil
}

func MatchDetails(ctx context.Context, dota *dota2.Dota2, matchID uint64) (*protocol.CMsgDOTAMatch, error) {
	answer, err := dota.RequestMatchDetails(ctx, matchID)
	if err != nil {
		return nil, err
	}

	if answer.GetMatch() == nil {
		return nil, fmt.Errorf("координатор не вернул матч %d: result=%d", matchID, answer.GetResult())
	}

	return answer.GetMatch(), nil
}
