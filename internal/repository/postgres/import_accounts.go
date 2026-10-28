package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ImportAccount struct {
	Id                 string
	DotaAccountId      *uint32
	LastCheckedMatchId *uint64
}

func ListImportAccounts(ctx context.Context, db *pgxpool.Pool) ([]*ImportAccount, error) {

	rows, err := db.Query(ctx, `
    SELECT
    a.id,
    a.dota_account_id,
    s.last_checked_match_id
    FROM public.import_accounts AS a
	LEFT JOIN public.gc_sync_state AS s
    ON s.account_id = a.dota_account_id
	ORDER BY a.id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]*ImportAccount, 0)

	for rows.Next() {
		notice := &ImportAccount{}

		err = rows.Scan(&notice.Id, &notice.DotaAccountId, &notice.LastCheckedMatchId)
		if err != nil {
			return nil, err
		}

		accounts = append(accounts, notice)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return accounts, nil

}
