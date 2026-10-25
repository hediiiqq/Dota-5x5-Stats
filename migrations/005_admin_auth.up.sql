create table public.admin_sessions(
    token_hash text primary key ,
    steam_id64 text not null ,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null check ( expires_at > created_at ) ,
    revoked_at timestamptz
);

CREATE INDEX admin_sessions_steam_id64_idx
    ON public.admin_sessions (steam_id64);