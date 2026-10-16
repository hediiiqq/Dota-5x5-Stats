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
	//mathces := []int64{9043752528, 9043639604, 9040846950}
	//var lobbytype uint32 = 1

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

		if match.LobbyType != nil && match.GetLobbyType() == 1 {
			log.Printf("id: %v, acc: %v, lobby type: %v, matchid: %v", idx, *accountID, match.GetLobbyType(), match.GetMatchId())
		}

	}
}
func HistoryMatch(ctx context.Context, dota *dota2.Dota2, accountID *uint32) {
	var matchId uint64 = 9043639604
	answer, err := dota.RequestMatchDetails(ctx, matchId)
	if err != nil {
		log.Printf("Error getting match history: %v", err)
		return
	}
	log.Printf("Match history: %v", answer)
}
