package dto

import "time"

type MatchResponse struct {
	ID                 int           `json:"id"`
	DotaMatchID        *string       `json:"dota_match_id"`
	StartedAt          *time.Time    `json:"started_at"`
	Duration           *int          `json:"duration"`
	Winner             *string       `json:"winner"`
	Players            []MatchPlayer `json:"players"`
	FirstBloodTime     *int          `json:"first_blood_time"`
	RadiantTeamName    *string       `json:"radiant_team_name"`
	DireTeamName       *string       `json:"dire_team_name"`
	RadiantTeamLogo    *string       `json:"radiant_team_logo"`
	DireTeamLogo       *string       `json:"dire_team_logo"`
	RadiantTeamLogoUrl *string       `json:"radiant_team_logo_url"`
	DireTeamLogoUrl    *string       `json:"dire_team_logo_url"`
	PicksBans          []PickBan     `json:"picks_bans"`
}

type MatchPlayer struct {
	Side               *string           `json:"side"`
	Nickname           *string           `json:"nickname"`
	AccountID          *string           `json:"account_id"`
	Hero               *int              `json:"hero_id"`
	Kills              *int              `json:"kills"`
	Deaths             *int              `json:"deaths"`
	Assists            *int              `json:"assists"`
	NetWorth           *int              `json:"net_worth"`
	XpPerMin           *int              `json:"xp_per_min"`
	PlayerSlot         *int              `json:"player_slot"`
	TeamNumber         *int              `json:"team_number"`
	TeamSlot           *int              `json:"team_slot"`
	PartyID            *string           `json:"party_id"`
	LeaverStatus       *int              `json:"leaver_status"`
	Level              *int              `json:"level"`
	LastHits           *int              `json:"last_hits"`
	Denies             *int              `json:"denies"`
	Gold               *int              `json:"gold"`
	GoldSpent          *int              `json:"gold_spent"`
	GoldPerMin         *int              `json:"gold_per_min"`
	GoldLostToDeath    *int              `json:"gold_lost_to_death"`
	HeroDamage         *int              `json:"hero_damage"`
	TowerDamage        *int              `json:"tower_damage"`
	HeroHealing        *int              `json:"hero_healing"`
	ScaledHeroDamage   *int              `json:"scaled_hero_damage"`
	ScaledTowerDamage  *int              `json:"scaled_tower_damage"`
	ScaledHeroHealing  *int              `json:"scaled_hero_healing"`
	DisableDuration    *float64          `json:"disable_duration"`
	SecondsDead        *int              `json:"seconds_dead"`
	BountyRunes        *int              `json:"bounty_runes"`
	OutpostsCaptured   *int              `json:"outposts_captured"`
	LaneSelectionFlags *int              `json:"lane_selection_flags"`
	HeroPickOrder      *int              `json:"hero_pick_order"`
	SelectedFacet      *int              `json:"selected_facet"`
	Item0              *int              `json:"item_0"`
	Item1              *int              `json:"item_1"`
	Item2              *int              `json:"item_2"`
	Item3              *int              `json:"item_3"`
	Item4              *int              `json:"item_4"`
	Item5              *int              `json:"item_5"`
	Item6              *int              `json:"item_6"`
	Item7              *int              `json:"item_7"`
	Item8              *int              `json:"item_8"`
	Item9              *int              `json:"item_9"`
	Item10             *int              `json:"item_10"`
	Item10Lvl          *int              `json:"item_10_lvl"`
	PermanentBuffs     []PermanentBuff   `json:"permanent_buffs"`
	HeroDamageReceived []DamageBreakdown `json:"hero_damage_received"`
	HeroDamageDealt    []DamageBreakdown `json:"hero_damage_dealt"`
}

type PermanentBuff struct {
	PermanentBuff *int     `json:"permanent_buff"`
	StackCount    *int     `json:"stack_count"`
	GrantTime     *float64 `json:"grant_time"`
}

type DamageBreakdown struct {
	PreReduction  *float64 `json:"pre_reduction"`
	PostReduction *float64 `json:"post_reduction"`
	DamageType    *int     `json:"damage_type"`
}

type PickBan struct {
	IsPick *bool `json:"is_pick"`
	Team   *int  `json:"team"`
	HeroId *int  `json:"hero_id"`
}
