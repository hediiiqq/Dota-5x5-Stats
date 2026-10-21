package dto

import "github.com/paralin/go-dota2/protocol"

// Use the installed GC schema's constants rather than inferring modes from draft data.
var gameModeNames = map[protocol.DOTA_GameMode]string{
	protocol.DOTA_GameMode_DOTA_GAMEMODE_AP:            "All Pick",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_CM:            "Captains Mode",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_RD:            "Random Draft",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_SD:            "Single Draft",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_AR:            "All Random",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_TUTORIAL:      "Tutorial",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_LP:            "Least Played",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_CUSTOM:        "Custom",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_CD:            "Captains Draft",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_BD:            "Balanced Draft",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_ABILITY_DRAFT: "Ability Draft",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_ARDM:          "All Random Deathmatch",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_1V1MID:        "1v1 Solo Mid",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_ALL_DRAFT:     "Ranked All Pick",
	protocol.DOTA_GameMode_DOTA_GAMEMODE_TURBO:         "Turbo",
}

func gameModeName(id *int) *string {
	if id == nil || *id < 0 || int64(*id) > 2147483647 {
		return nil
	}
	name, ok := gameModeNames[protocol.DOTA_GameMode(*id)]
	if !ok {
		return nil
	}
	return &name
}
