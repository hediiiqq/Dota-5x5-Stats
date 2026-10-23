package dto

import (
	"dota-stats/internal/source/coordinator"
	"strconv"
	"time"
)

func ToMatchResponse(id int, source coordinator.GCMatch) MatchResponse {

	match := MatchResponse{
		ID:           id,
		Duration:     source.Duration,
		GameMode:     source.GameMode,
		GameModeName: gameModeName(source.GameMode),
		Players:      make([]MatchPlayer, 0, len(source.Players)),
		PicksBans:    make([]PickBan, 0, len(source.PicksBans)),
	}

	if source.MatchID != nil {
		value := strconv.FormatUint(*source.MatchID, 10)
		match.DotaMatchID = &value
	}

	if source.StartTime != nil {
		startedAt := time.Unix(*source.StartTime, 0).UTC()
		match.StartedAt = &startedAt
	}

	if source.FirstBloodTime != nil {
		firstBloodTime := *source.FirstBloodTime
		match.FirstBloodTime = &firstBloodTime
	}

	if source.RadiantTeamName != nil && *source.RadiantTeamName != "" {
		match.RadiantTeamName = source.RadiantTeamName
	}
	if source.DireTeamName != nil && *source.DireTeamName != "" {
		match.DireTeamName = source.DireTeamName
	}
	if source.RadiantTeamLogo != nil && *source.RadiantTeamLogo != 0 {
		value := strconv.FormatUint(*source.RadiantTeamLogo, 10)
		match.RadiantTeamLogo = &value
	}
	if source.DireTeamLogo != nil && *source.DireTeamLogo != 0 {
		value := strconv.FormatUint(*source.DireTeamLogo, 10)
		match.DireTeamLogo = &value
	}
	if source.RadiantTeamLogoUrl != nil && *source.RadiantTeamLogoUrl != "" {
		match.RadiantTeamLogoUrl = source.RadiantTeamLogoUrl
	}
	if source.DireTeamLogoUrl != nil && *source.DireTeamLogoUrl != "" {
		match.DireTeamLogoUrl = source.DireTeamLogoUrl
	}

	var winner *string

	if source.MatchOutcome != nil {
		switch *source.MatchOutcome {
		case 2:
			value := "radiant"
			winner = &value
		case 3:
			value := "dire"
			winner = &value

		}
	}
	match.Winner = winner

	for _, pickBan := range source.PicksBans {

		match.PicksBans = append(match.PicksBans, PickBan{
			IsPick:      pickBan.IsPick,
			Team:        pickBan.Team,
			HeroId:      pickBan.Hero,
			HeroName:    heroName(pickBan.Hero),
			HeroIconURL: heroIconURL(pickBan.Hero),
		})
	}

	for _, player := range source.Players {
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
		var abilityUpgrades []int

		if player.StatsHistory != nil {
			abilityUpgrades = player.StatsHistory.AbilityUpgrades
		}

		match.Players = append(match.Players, MatchPlayer{
			Side:               side,
			Nickname:           player.PlayerName,
			AccountID:          accountID,
			Hero:               player.HeroID,
			HeroName:           heroName(player.HeroID),
			HeroIconURL:        heroIconURL(player.HeroID),
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
			AbilityUpgrades:    abilityUpgrades,
		})
	}

	return match
}
