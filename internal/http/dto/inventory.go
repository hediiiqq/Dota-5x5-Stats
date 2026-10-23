package dto

type InventorySnapshot struct {
	GameTime             int32   `json:"game_time"`
	ItemIDs              []int32 `json:"item_ids"`
	BackpackItemIDs      []int32 `json:"backpack_item_ids"`
	NeutralItemID        *int32  `json:"neutral_item_id"`
	NeutralEnhancementID *int32  `json:"neutral_enhancement_id"`
	Kills                *uint32 `json:"kills"`
	Deaths               *uint32 `json:"deaths"`
	Assists              *uint32 `json:"assists"`
	Level                *uint32 `json:"level"`
	LastHits             *uint32 `json:"last_hits"`
	Denies               *uint32 `json:"denies"`
	Flags                *uint32 `json:"flags"`
}

type PlayerInventory struct {
	PlayerSlot uint32              `json:"player_slot"`
	Snapshots  []InventorySnapshot `json:"snapshots"`
	NetWorth   []NetWorthPoint     `json:"net_worth"`
}

type InventoryResponse struct {
	MatchID     string            `json:"match_id"`
	DotaMatchID string            `json:"dota_match_id"`
	Available   bool              `json:"available"`
	Players     []PlayerInventory `json:"players"`
}

type NetWorthPoint struct {
	GameTime int32   `json:"game_time"`
	Value    float64 `json:"value"`
}
