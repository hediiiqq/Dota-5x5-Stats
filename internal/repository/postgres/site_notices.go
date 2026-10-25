package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SiteNotice struct {
	Id   int64
	Text string
}

func ListSiteNotices(ctx context.Context, db *pgxpool.Pool) ([]*SiteNotice, error) {

	rows, err := db.Query(ctx, `
    SELECT id, text
    FROM public.site_notices
    ORDER BY id DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notices := make([]*SiteNotice, 0)

	for rows.Next() {
		notice := &SiteNotice{}

		err := rows.Scan(&notice.Id, &notice.Text)
		if err != nil {
			return nil, err
		}

		notices = append(notices, notice)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return notices, nil
}

func CreateSiteNotice(ctx context.Context, db *pgxpool.Pool, text string) (*SiteNotice, error) {

	notice := &SiteNotice{}

	err := db.QueryRow(ctx, `
INSERT INTO public.site_notices (text)
VALUES ($1)
RETURNING id, text
`, text).Scan(&notice.Id, &notice.Text)
	if err != nil {
		return nil, err
	}
	return notice, nil
}

func UpdateSiteNotice(ctx context.Context, db *pgxpool.Pool, id int64, text string) (*SiteNotice, bool, error) {

	notice := &SiteNotice{}

	err := db.QueryRow(ctx, `
update public.site_notices set text = $1 where id = $2
RETURNING id, text
`, text, id).Scan(&notice.Id, &notice.Text)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return notice, true, nil

}

func DeleteSiteNotice(ctx context.Context, db *pgxpool.Pool, id int64) (bool, error) {

	tag, err := db.Exec(ctx, "DELETE FROM public.site_notices WHERE id = $1", id)
	if err != nil {
		return false, err
	}

	if tag.RowsAffected() == 0 {
		return false, nil
	}

	return true, nil
}
