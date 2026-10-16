package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

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

type Match struct {
	ID          int           `json:"id"`
	DotaMatchID *string       `json:"dota_match_id"`
	StartedAt   *time.Time    `json:"started_at"`
	Duration    *int          `json:"duration"`
	Winner      *string       `json:"winner"`
	Players     []MatchPlayer `json:"players"`
}

// GC types describe the source JSON. They never become HTTP responses directly.
type GCResponse struct {
	Result *int     `json:"result"`
	Match  *GCMatch `json:"match"`
}

type GCMatch struct {
	MatchID      *uint64    `json:"matchId"`
	StartTime    *int64     `json:"starttime"`
	Duration     *int       `json:"duration"`
	MatchOutcome *int       `json:"matchOutcome"`
	Players      []GCPlayer `json:"players"`
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

type PermanentBuff struct {
	PermanentBuff *int     `json:"permanent_buff"`
	StackCount    *int     `json:"stack_count"`
	GrantTime     *float64 `json:"grant_time"`
}

type GCDamageBreakdown struct {
	PreReduction  *float64 `json:"preReduction"`
	PostReduction *float64 `json:"postReduction"`
	DamageType    *int     `json:"damageType"`
}

type DamageBreakdown struct {
	PreReduction  *float64 `json:"pre_reduction"`
	PostReduction *float64 `json:"post_reduction"`
	DamageType    *int     `json:"damage_type"`
}

type ApiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type ErrorResponse struct {
	Error ApiError `json:"error"`
}

func (m Match) Validate() error {
	if len(m.Players) != 10 {
		return fmt.Errorf("need 10 players, got %d", len(m.Players))
	}
	return nil
}

func main() {
	data, err := os.ReadFile("testdata/match.json")
	if err != nil {
		log.Fatal(err)
	}

	var response GCResponse
	err = json.Unmarshal(data, &response)
	if err != nil {
		log.Fatal(err)
	}
	if response.Match == nil {
		log.Fatal("response contains no match")
	}

	match := Match{
		ID:       1,
		Duration: response.Match.Duration,
		Winner:   nil,
		Players:  make([]MatchPlayer, 0, len(response.Match.Players)),
	}
	if response.Match.MatchID != nil {
		value := strconv.FormatUint(*response.Match.MatchID, 10)
		match.DotaMatchID = &value
	}
	if response.Match.StartTime != nil {
		startedAt := time.Unix(*response.Match.StartTime, 0).UTC()
		match.StartedAt = &startedAt
	}

	for _, player := range response.Match.Players {
		var side *string
		if player.TeamNumber != nil {
			switch *player.TeamNumber {
			case 0:
				value := "radiant"
				side = &value
			case 1:
				value := "dire"
				side = &value
			}
		}

		var accountID *string
		if player.AccountID != nil {
			value := strconv.FormatUint(uint64(*player.AccountID), 10)
			accountID = &value
		}
		var partyID *string
		if player.PartyID != nil {
			value := strconv.FormatUint(*player.PartyID, 10)
			partyID = &value
		}

		var buffs []PermanentBuff
		if player.PermanentBuffs != nil {
			buffs = make([]PermanentBuff, 0, len(player.PermanentBuffs))
			for _, buff := range player.PermanentBuffs {
				buffs = append(buffs, PermanentBuff{
					PermanentBuff: buff.PermanentBuff,
					StackCount:    buff.StackCount,
					GrantTime:     buff.GrantTime,
				})
			}
		}

		var received []DamageBreakdown
		if player.HeroDamageReceived != nil {
			received = make([]DamageBreakdown, 0, len(player.HeroDamageReceived))
			for _, entry := range player.HeroDamageReceived {
				received = append(received, DamageBreakdown{
					PreReduction:  entry.PreReduction,
					PostReduction: entry.PostReduction,
					DamageType:    entry.DamageType,
				})
			}
		}

		var dealt []DamageBreakdown
		if player.HeroDamageDealt != nil {
			dealt = make([]DamageBreakdown, 0, len(player.HeroDamageDealt))
			for _, entry := range player.HeroDamageDealt {
				dealt = append(dealt, DamageBreakdown{
					PreReduction:  entry.PreReduction,
					PostReduction: entry.PostReduction,
					DamageType:    entry.DamageType,
				})
			}
		}

		match.Players = append(match.Players, MatchPlayer{
			Side:               side,
			Nickname:           player.PlayerName,
			AccountID:          accountID,
			Hero:               player.HeroID,
			Kills:              player.Kills,
			Deaths:             player.Deaths,
			Assists:            player.Assists,
			NetWorth:           player.NetWorth,
			XpPerMin:           player.XpPerMin,
			PlayerSlot:         player.PlayerSlot,
			TeamNumber:         player.TeamNumber,
			TeamSlot:           player.TeamSlot,
			PartyID:            partyID,
			LeaverStatus:       player.LeaverStatus,
			Level:              player.Level,
			LastHits:           player.LastHits,
			Denies:             player.Denies,
			Gold:               player.Gold,
			GoldSpent:          player.GoldSpent,
			GoldPerMin:         player.GoldPerMin,
			GoldLostToDeath:    player.GoldLostToDeath,
			HeroDamage:         player.HeroDamage,
			TowerDamage:        player.TowerDamage,
			HeroHealing:        player.HeroHealing,
			ScaledHeroDamage:   player.ScaledHeroDamage,
			ScaledTowerDamage:  player.ScaledTowerDamage,
			ScaledHeroHealing:  player.ScaledHeroHealing,
			DisableDuration:    player.DisableDuration,
			SecondsDead:        player.SecondsDead,
			BountyRunes:        player.BountyRunes,
			OutpostsCaptured:   player.OutpostsCaptured,
			LaneSelectionFlags: player.LaneSelectionFlags,
			HeroPickOrder:      player.HeroPickOrder,
			SelectedFacet:      player.SelectedFacet,
			Item0:              player.Item0,
			Item1:              player.Item1,
			Item2:              player.Item2,
			Item3:              player.Item3,
			Item4:              player.Item4,
			Item5:              player.Item5,
			Item6:              player.Item6,
			Item7:              player.Item7,
			Item8:              player.Item8,
			Item9:              player.Item9,
			Item10:             player.Item10,
			Item10Lvl:          player.Item10Lvl,
			PermanentBuffs:     buffs,
			HeroDamageReceived: received,
			HeroDamageDealt:    dealt,
		})
	}

	if err := match.Validate(); err != nil {
		log.Fatal(err)
	}
	matches := []Match{match}

	http.HandleFunc("GET /api/matches/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))

		if id <= 0 || err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			code := "invalid_match_id"
			message := "ID должен быть положительным целым числом"
			apiError := ApiError{
				Code:    code,
				Message: message,
			}
			errorResponse := ErrorResponse{Error: apiError}
			err := json.NewEncoder(w).Encode(errorResponse)
			if err != nil {
				log.Printf("Error encoding json: %v", err)
				return
			}
			return
		}
		if id != match.ID {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			code := "match_not_found"
			message := "матч не найден"
			apiError := ApiError{
				Code:    code,
				Message: message,
			}
			errorResponse := ErrorResponse{Error: apiError}
			err := json.NewEncoder(w).Encode(errorResponse)
			if err != nil {
				log.Printf("Error encoding json: %v", err)
				return
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		err = json.NewEncoder(w).Encode(match)
		if err != nil {
			log.Printf("encode match: %v", err)
			return
		}
	})

	http.HandleFunc("GET /api/matches", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		err := json.NewEncoder(w).Encode(matches)
		if err != nil {
			log.Printf("encode matches: %v", err)
			return
		}
	})

	http.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	err = http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal(err)
	}
}
