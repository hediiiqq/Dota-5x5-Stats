package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/paralin/go-dota2/protocol"
)

func SaveMatchPlayers(ctx context.Context, tx pgx.Tx, id int64, players []*protocol.CMsgDOTAMatch_Player) error {
	for _, player := range players {
		if player == nil {
			return errors.New("в списке игроков отсутствует объект игрока")
		}
		if player.AccountId == nil {
			return errors.New("у игрока отсутствует ID аккаунта")
		}
		if *player.AccountId == 0 {
			return errors.New("ID аккаунта игрока равен нулю")
		}
		_, err := tx.Exec(ctx, `
		INSERT INTO public.match_players (match_id,account_id,nickname,team_number,hero_id,kills,deaths,assists)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		
		`, id, player.AccountId, player.PlayerName, player.TeamNumber, player.HeroId, player.Kills, player.Deaths, player.Assists)
		if err != nil {
			return err
		}
	}
	return nil
}
