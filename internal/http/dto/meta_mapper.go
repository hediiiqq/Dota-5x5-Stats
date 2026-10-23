package dto

import (
	"strconv"

	"github.com/paralin/go-dota2/protocol"
)

func ToMetaResponse(matchId int, source protocol.CDOTAMatchMetadataFile) PurchasesResponse {

	purchases := PurchasesResponse{
		DotaMatchId: strconv.FormatUint(source.GetMatchId(), 10),
		MatchId:     strconv.FormatUint(uint64(matchId), 10),
		Available:   true,
		Players:     make([]PlayerPurchase, 0),
	}

	for _, teams := range source.GetMetadata().GetTeams() {

		for _, player := range teams.GetPlayers() {

			playerPurchase := PlayerPurchase{
				PlayerSlot: player.GetPlayerSlot(),
				Purchases:  make([]Purchase, 0, len(player.GetItems())),
			}

			for _, items := range player.GetItems() {

				playerPurchase.Purchases = append(playerPurchase.Purchases, Purchase{
					ItemId: items.GetItemId(),
					Time:   items.GetPurchaseTime(),
				})
			}

			purchases.Players = append(purchases.Players, playerPurchase)
		}

	}
	return purchases
}
