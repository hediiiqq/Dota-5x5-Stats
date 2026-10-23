package dto

import (
	"errors"
	"fmt"
	"github.com/paralin/go-dota2/protocol"
	"math"
	"sort"
	"strconv"
)

// sampledGraph shares the empirical inventory time axis. Unverified series
// are explicitly listed in PreliminarySeries.
func sampledGraph(values []float32, duration uint32, worth bool) ([]GraphPoint, error) {
	if len(values) == 0 {
		return nil, nil
	}
	points := make([]GraphPoint, 0, len(values))
	for index, value := range values {
		raw := float64(value)
		if math.IsNaN(raw) || math.IsInf(raw, 0) || raw < 0 {
			return nil, errors.New("некорректное значение графика")
		}
		normalized := math.Round(raw * 10)
		if worth {
			normalized = math.Floor(raw) * 10
		}
		points = append(points, GraphPoint{
			GameTime: int32(math.Ceil(float64(index) * float64(duration) / float64(len(values)))),
			Value:    normalized,
		})
	}
	return points, nil
}

func ToGraphResponse(matchID int, source protocol.CDOTAMatchMetadataFile, duration uint32) (GraphsResponse, error) {
	if source.Metadata == nil {
		return GraphsResponse{}, errors.New("отсутствуют публичные метаданные")
	}
	if matchID <= 0 || source.GetMatchId() == 0 {
		return GraphsResponse{}, errors.New("некорректный ID матча")
	}
	if duration == 0 || duration > math.MaxInt32 {
		return GraphsResponse{}, errors.New("некорректная длительность матча")
	}
	response := GraphsResponse{
		MatchID: strconv.Itoa(matchID), DotaMatchID: strconv.FormatUint(source.GetMatchId(), 10), Duration: duration,
		Teams: make([]TeamGraphs, 0), Players: make([]PlayerGraphs, 0), Kills: make([]GraphKill, 0),
		PreliminarySeries: make([]string, 0),
	}
	seenSlots := make(map[uint32]bool)
	seenTeams := make(map[uint32]bool)
	preliminary := make(map[string]bool)
	for _, team := range source.Metadata.GetTeams() {
		if team == nil {
			continue
		}
		teamID := uint32(team.GetDotaTeam())
		if teamID != 2 && teamID != 3 {
			continue
		}
		if seenTeams[teamID] {
			return GraphsResponse{}, errors.New("повтор команды")
		}
		seenTeams[teamID] = true
		side := "radiant"
		if teamID == 3 {
			side = "dire"
		}
		worth, err := sampledGraph(team.GetGraphNetWorth(), duration, true)
		if err != nil {
			return GraphsResponse{}, fmt.Errorf("ОЦ команды: %w", err)
		}
		xp, err := sampledGraph(team.GetGraphExperience(), duration, false)
		if err != nil {
			return GraphsResponse{}, fmt.Errorf("опыт команды: %w", err)
		}
		response.Teams = append(response.Teams, TeamGraphs{Side: side, NetWorth: worth, Experience: xp})
		if len(worth) > 0 {
			response.Available = true
			preliminary["team_net_worth"] = true
		}
		if len(xp) > 0 {
			response.Available = true
			preliminary["team_experience"] = true
		}
		for _, player := range team.GetPlayers() {
			if player == nil || player.PlayerSlot == nil {
				return GraphsResponse{}, errors.New("отсутствует слот игрока")
			}
			slot := player.GetPlayerSlot()
			if (teamID == 2 && slot > 4) || (teamID == 3 && (slot < 128 || slot > 132)) {
				return GraphsResponse{}, errors.New("слот не соответствует стороне игрока")
			}
			if seenSlots[slot] {
				return GraphsResponse{}, errors.New("повтор слота игрока")
			}
			seenSlots[slot] = true
			worth, err := sampledGraph(player.GetGraphNetWorth(), duration, true)
			if err != nil {
				return GraphsResponse{}, fmt.Errorf("ОЦ игрока %d: %w", slot, err)
			}
			damage, err := sampledGraph(player.GetGraphHeroDamage(), duration, false)
			if err != nil {
				return GraphsResponse{}, fmt.Errorf("урон игрока %d: %w", slot, err)
			}
			if len(damage) > 0 {
				preliminary["hero_damage"] = true
			}
			times := player.GetLevelUpTimes()
			if len(times) > 29 {
				return GraphsResponse{}, errors.New("повышений уровня больше 29")
			}
			levels := []GraphPoint{{GameTime: 0, Value: 1}}
			for index, time := range times {
				if time > duration || time > math.MaxInt32 || (index > 0 && time < times[index-1]) {
					return GraphsResponse{}, errors.New("некорректное время повышения уровня")
				}
				levels = append(levels, GraphPoint{GameTime: int32(time), Value: float64(index + 2)})
			}
			response.Players = append(response.Players, PlayerGraphs{PlayerSlot: slot, NetWorth: worth, HeroDamage: damage, Levels: levels})
			response.Available = true
		}
	}
	for _, team := range source.Metadata.GetTeams() {
		if team == nil || (team.GetDotaTeam() != 2 && team.GetDotaTeam() != 3) {
			continue
		}
		for _, kill := range team.GetKills() {
			if kill == nil {
				return GraphsResponse{}, errors.New("пустое событие")
			}
			if kill.GetKillType() != 0 {
				continue
			}
			if kill.Time == nil || kill.VictimPlayerSlot == nil {
				return GraphsResponse{}, errors.New("у убийства нет времени или жертвы")
			}
			if int64(kill.GetTime()) > int64(duration) {
				return GraphsResponse{}, errors.New("убийство позже окончания игры")
			}
			victim := kill.GetVictimPlayerSlot()
			if !seenSlots[victim] {
				continue
			}
			if kill.Bounty != nil && *kill.Bounty < 0 {
				return GraphsResponse{}, errors.New("отрицательная награда за убийство")
			}
			killers := make([]uint32, 0)
			used := make(map[uint32]bool)
			for _, slot := range kill.GetKillerPlayerSlot() {
				if seenSlots[slot] && !used[slot] {
					killers = append(killers, slot)
					used[slot] = true
				}
			}
			response.Kills = append(response.Kills, GraphKill{GameTime: kill.GetTime(), VictimPlayerSlot: victim, KillerPlayerSlots: killers, Bounty: kill.Bounty})
		}
	}
	sort.SliceStable(response.Kills, func(i, j int) bool { return response.Kills[i].GameTime < response.Kills[j].GameTime })
	for _, name := range []string{"team_net_worth", "team_experience", "hero_damage"} {
		if preliminary[name] {
			response.PreliminarySeries = append(response.PreliminarySeries, name)
		}
	}
	return response, nil
}
