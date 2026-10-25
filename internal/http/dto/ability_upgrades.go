package dto

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/paralin/go-dota2/protocol"
)

// MergeAbilityUpgrades fills missing GC histories from the separately stored
// metadata. Validate the entire payload before mutating the response.
func MergeAbilityUpgrades(match *MatchResponse, metadata protocol.CDOTAMatchMetadataFile) error {
	if match.DotaMatchID == nil || *match.DotaMatchID != strconv.FormatUint(metadata.GetMatchId(), 10) {
		return errors.New("ID основного матча и метаданных не совпадают")
	}
	if metadata.GetMetadata() == nil {
		return errors.New("сохранённые метаданные матча отсутствуют")
	}
	histories := make(map[uint32][]int)
	seen := make(map[uint32]bool)
	for _, team := range metadata.GetMetadata().GetTeams() {
		for _, player := range team.GetPlayers() {
			if player == nil || player.PlayerSlot == nil {
				return errors.New("в метаданных прокачки отсутствует слот игрока")
			}
			slot := player.GetPlayerSlot()
			if seen[slot] {
				return fmt.Errorf("повторный слот игрока в метаданных прокачки: %d", slot)
			}
			seen[slot] = true
			if player.AbilityUpgrades == nil {
				continue
			}
			upgrades := make([]int, len(player.AbilityUpgrades))
			for i, id := range player.AbilityUpgrades {
				upgrades[i] = int(id)
			}
			histories[slot] = upgrades
		}
	}
	for i := range match.Players {
		player := &match.Players[i]
		if len(player.AbilityUpgrades) != 0 || player.PlayerSlot == nil || *player.PlayerSlot < 0 {
			continue
		}
		if upgrades, ok := histories[uint32(*player.PlayerSlot)]; ok {
			player.AbilityUpgrades = upgrades
		}
	}
	return nil
}
