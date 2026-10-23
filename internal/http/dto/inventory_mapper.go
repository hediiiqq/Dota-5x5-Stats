package dto

import (
	"errors"
	"log"
	"math"
	"sort"
	"strconv"

	"github.com/paralin/go-dota2/protocol"
)

func ToInventoryResponse(matchId int, source protocol.CDOTAMatchMetadataFile, duration uint32) (InventoryResponse, error) {

	var seenSlots = make(map[uint32]bool)

	if source.Metadata == nil {
		log.Printf("метадата пустая или отсутствует")
		return InventoryResponse{}, errors.New("метадата пустая или отсутствует")
	}

	inventory := InventoryResponse{
		MatchID:     strconv.FormatUint(uint64(matchId), 10),
		DotaMatchID: strconv.FormatUint(source.GetMatchId(), 10),
		Available:   false,
		Players:     make([]PlayerInventory, 0),
	}

	for _, team := range source.GetMetadata().GetTeams() {

		for _, player := range team.GetPlayers() {

			if player.PlayerSlot == nil {
				log.Printf("слот игрока пустой")
				return InventoryResponse{}, errors.New("пустой слот игрока")
			}

			if seenSlots[*player.PlayerSlot] {
				log.Printf("повтор игрока на слоте %v, в матче %v", *player.PlayerSlot, source.GetMatchId())
				return InventoryResponse{}, errors.New("повтор игрока в слоте")
			} else {
				seenSlots[*player.PlayerSlot] = true
			}

			playerInventory := PlayerInventory{
				PlayerSlot: player.GetPlayerSlot(),
				Snapshots:  make([]InventorySnapshot, 0),
				NetWorth:   make([]NetWorthPoint, 0),
			}

			graph := player.GetGraphNetWorth()
			if len(graph) > 0 && duration == 0 {
				return InventoryResponse{}, errors.New("для graphNetWorth отсутствует длительность матча")
			}

			for index, value := range graph {
				raw := float64(value)

				if math.IsNaN(raw) || math.IsInf(raw, 0) || raw < 0 {
					return InventoryResponse{}, errors.New(
						"некорректное значение graphNetWorth",
					)
				}

				playerInventory.NetWorth = append(
					playerInventory.NetWorth,
					NetWorthPoint{
						GameTime: int32(math.Ceil(float64(index) * float64(duration) / float64(len(graph)))),
						Value:    math.Floor(raw) * 10,
					},
				)
			}

			for _, snapshot := range player.GetInventorySnapshot() {

				if snapshot.GameTime == nil {
					log.Printf("время в снапшоте пустое ")
					return InventoryResponse{}, errors.New("пустое время снапшота")
				}

				invSnapshot := InventorySnapshot{
					GameTime:             snapshot.GetGameTime(),
					ItemIDs:              snapshot.GetItemId(),
					BackpackItemIDs:      snapshot.GetBackpackItemId(),
					NeutralItemID:        snapshot.NeutralItemId,
					NeutralEnhancementID: snapshot.NeutralEnhancementId,
					Kills:                snapshot.Kills,
					Deaths:               snapshot.Deaths,
					Assists:              snapshot.Assists,
					Level:                snapshot.Level,
					LastHits:             snapshot.LastHits,
					Denies:               snapshot.Denies,
					Flags:                snapshot.Flags,
				}

				if invSnapshot.ItemIDs == nil {
					invSnapshot.ItemIDs = []int32{}
				}

				if invSnapshot.BackpackItemIDs == nil {
					invSnapshot.BackpackItemIDs = []int32{}
				}

				playerInventory.Snapshots = append(playerInventory.Snapshots, invSnapshot)

			}

			sort.SliceStable(playerInventory.Snapshots, func(i, j int) bool {

				return playerInventory.Snapshots[i].GameTime < playerInventory.Snapshots[j].GameTime
			})
			if len(playerInventory.Snapshots) > 0 {
				inventory.Available = true
			}

			inventory.Players = append(inventory.Players, playerInventory)

		}
	}
	if inventory.Available == false {
		inventory.Players = []PlayerInventory{}
	}
	return inventory, nil
}
