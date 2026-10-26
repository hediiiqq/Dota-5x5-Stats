create table public.import_accounts(
    id text primary key ,
    dota_account_id bigint unique CHECK (dota_account_id BETWEEN 1 AND 4294967295),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);