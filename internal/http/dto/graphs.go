package dto

type GraphPoint struct {
	GameTime int32   `json:"game_time"`
	Value    float64 `json:"value"`
}

type TeamGraphs struct {
	Side       string       `json:"side"`
	NetWorth   []GraphPoint `json:"net_worth"`
	Experience []GraphPoint `json:"experience"`
}

type PlayerGraphs struct {
	PlayerSlot uint32       `json:"player_slot"`
	NetWorth   []GraphPoint `json:"net_worth"`
	HeroDamage []GraphPoint `json:"hero_damage"`
	Levels     []GraphPoint `json:"levels"`
}

type GraphKill struct {
	GameTime          int32    `json:"game_time"`
	KillerPlayerSlots []uint32 `json:"killer_player_slots"`
	VictimPlayerSlot  uint32   `json:"victim_player_slot"`
	Bounty            *int32   `json:"bounty"`
}

type GraphsResponse struct {
	PreliminarySeries []string       `json:"preliminary_series"`
	MatchID           string         `json:"match_id"`
	DotaMatchID       string         `json:"dota_match_id"`
	Duration          uint32         `json:"duration"`
	Available         bool           `json:"available"`
	Teams             []TeamGraphs   `json:"teams"`
	Players           []PlayerGraphs `json:"players"`
	Kills             []GraphKill    `json:"kills"`
}
