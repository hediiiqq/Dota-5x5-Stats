package dto

type Purchase struct {
	ItemId int32 `json:"item_id"`
	Time   int32 `json:"time"`
}

type PlayerPurchase struct {
	PlayerSlot uint32     `json:"player_slot"`
	Purchases  []Purchase `json:"purchases"`
}

type PurchasesResponse struct {
	MatchId     string           `json:"match_id"`
	DotaMatchId string           `json:"dota_match_id"`
	Available   bool             `json:"available"`
	Players     []PlayerPurchase `json:"players"`
}
