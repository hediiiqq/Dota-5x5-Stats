package coordinator

type GCMatch struct {
	MatchID            *uint64     `json:"matchId"`
	StartTime          *int64      `json:"starttime"`
	Duration           *int        `json:"duration"`
	MatchOutcome       *int        `json:"matchOutcome"`
	Players            []GCPlayer  `json:"players"`
	FirstBloodTime     *int        `json:"firstBloodTime"`
	PicksBans          []GCPickBan `json:"picksBans"`
	RadiantTeamName    *string     `json:"radiantTeamName"`
	DireTeamName       *string     `json:"direTeamName"`
	RadiantTeamLogo    *uint64     `json:"radiantTeamLogo"`
	DireTeamLogo       *uint64     `json:"direTeamLogo"`
	RadiantTeamLogoUrl *string     `json:"radiantTeamLogoUrl"`
	DireTeamLogoUrl    *string     `json:"direTeamLogoUrl"`
}

type GCPlayer struct {
	PlayerName         *string             `json:"playerName"`
	AccountID          *uint32             `json:"accountId"`
	HeroID             *int                `json:"heroId"`
	Kills              *int                `json:"kills"`
	Deaths             *int                `json:"deaths"`
	Assists            *int                `json:"assists"`
	NetWorth           *int                `json:"netWorth"`
	XpPerMin           *int                `json:"xpPerMin"`
	PlayerSlot         *int                `json:"playerSlot"`
	TeamNumber         *int                `json:"teamNumber"`
	TeamSlot           *int                `json:"teamSlot"`
	PartyID            *uint64             `json:"partyId"`
	LeaverStatus       *int                `json:"leaverStatus"`
	Level              *int                `json:"level"`
	LastHits           *int                `json:"lastHits"`
	Denies             *int                `json:"denies"`
	Gold               *int                `json:"gold"`
	GoldSpent          *int                `json:"goldSpent"`
	GoldPerMin         *int                `json:"goldPerMin"`
	GoldLostToDeath    *int                `json:"goldLostToDeath"`
	HeroDamage         *int                `json:"heroDamage"`
	TowerDamage        *int                `json:"towerDamage"`
	HeroHealing        *int                `json:"heroHealing"`
	ScaledHeroDamage   *int                `json:"scaledHeroDamage"`
	ScaledTowerDamage  *int                `json:"scaledTowerDamage"`
	ScaledHeroHealing  *int                `json:"scaledHeroHealing"`
	DisableDuration    *float64            `json:"disableDuration"`
	SecondsDead        *int                `json:"secondsDead"`
	BountyRunes        *int                `json:"bountyRunes"`
	OutpostsCaptured   *int                `json:"outpostsCaptured"`
	LaneSelectionFlags *int                `json:"laneSelectionFlags"`
	HeroPickOrder      *int                `json:"heroPickOrder"`
	SelectedFacet      *int                `json:"selectedFacet"`
	Item0              *int                `json:"item0"`
	Item1              *int                `json:"item1"`
	Item2              *int                `json:"item2"`
	Item3              *int                `json:"item3"`
	Item4              *int                `json:"item4"`
	Item5              *int                `json:"item5"`
	Item6              *int                `json:"item6"`
	Item7              *int                `json:"item7"`
	Item8              *int                `json:"item8"`
	Item9              *int                `json:"item9"`
	Item10             *int                `json:"item10"`
	Item10Lvl          *int                `json:"item10Lvl"`
	PermanentBuffs     []GCPermanentBuff   `json:"permanentBuffs"`
	HeroDamageReceived []GCDamageBreakdown `json:"heroDamageReceived"`
	HeroDamageDealt    []GCDamageBreakdown `json:"heroDamageDealt"`
}

type GCPermanentBuff struct {
	PermanentBuff *int     `json:"permanentBuff"`
	StackCount    *int     `json:"stackCount"`
	GrantTime     *float64 `json:"grantTime"`
}

type GCDamageBreakdown struct {
	PreReduction  *float64 `json:"preReduction"`
	PostReduction *float64 `json:"postReduction"`
	DamageType    *int     `json:"damageType"`
}

type GCPickBan struct {
	IsPick *bool `json:"isPick"`
	Team   *int  `json:"team"`
	Hero   *int  `json:"heroId"`
}
