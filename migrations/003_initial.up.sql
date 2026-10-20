CREATE TABLE public.gc_sync_state
(
    account_id bigint primary key ,
    last_checked_match_id bigint not null ,
    updated_at timestamptz not null default now()
)