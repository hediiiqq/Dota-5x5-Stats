package coordinator

import (
	"context"
	"log"

	"github.com/paralin/go-dota2"
	"github.com/paralin/go-dota2/protocol"
)

func HistoryDota(ctx context.Context, dota *dota2.Dota2, accountID *uint32) {

	var ReqMatches uint32 = 20
	var PracticeMatches bool = true

	request := protocol.CMsgDOTAGetPlayerMatchHistory{
		AccountId:              accountID,
		MatchesRequested:       &ReqMatches,
		IncludePracticeMatches: &PracticeMatches,
	}

	answer, err := dota.GetPlayerMatchHistory(ctx, &request)
	if err != nil {
		log.Printf("Error getting match history: %v", err)
		return
	}
	log.Printf("Match history: %v", len(answer.Matches))
	for idx, match := range answer.Matches {

		if match.LobbyType != nil && match.GetLobbyType() == 1 && (match.GetGameMode() == 16 || match.GetGameMode() == 2) {
			log.Printf("id: %v, gameMode:%v, acc: %v, lobby type: %v, matchid: %v", idx, match.GetGameMode(), *accountID, match.GetLobbyType(), match.GetMatchId())
		}

	}
}
