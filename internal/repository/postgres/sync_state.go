package postgres

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func GetSyncState(ctx context.Context, pool *pgxpool.Pool, id int64) (lastCheckedMatchId uint64, found bool, err error) {

	err = pool.QueryRow(ctx, `
	select last_checked_match_id from public.gc_sync_state where account_id = $1 
	`, id).Scan(&lastCheckedMatchId)

	if errors.Is(err, pgx.ErrNoRows) {
		log.Printf("Записи нет в бд,отсутствие записи - нормальный первый запуск аккаунт %v", id)
		return 0, false, nil
	}

	if err != nil {
		log.Printf("Не удалось прочитать прогресс синхронизации аккаунта  %v, ошибка %v", id, err)
		return 0, false, err
	}

	return lastCheckedMatchId, true, nil

}

func SaveSyncState(ctx context.Context, pool *pgxpool.Pool, accountId int64, lastCheckedMatchId uint64) error {

	_, err := pool.Exec(ctx, `
	insert into public.gc_sync_state (account_id, last_checked_match_id,updated_at)
	values ($1, $2, $3)
	on conflict (account_id) do update set last_checked_match_id = greatest(gc_sync_state.last_checked_match_id, $2)  , updated_at = $3;
`, accountId, lastCheckedMatchId, time.Now())
	if err != nil {
		log.Printf("Ошибка сохранения прогресса синхронизации: %v , ошибка:%v", accountId, err)
		return err
	}
	return nil

}
