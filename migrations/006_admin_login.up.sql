create table public.admin_login_attempts (
    state_hash text primary key ,
    browser_token_hash text not null ,
    return_to text not null ,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null check ( expires_at > created_at ) ,
    used_at timestamptz
);

create table public.admin_openid_nonces(
    nonce text primary key ,
    expires_at timestamptz not null
);

CREATE INDEX admin_login_attempts_expires_at_idx
    ON public.admin_login_attempts (expires_at);

CREATE INDEX admin_openid_nonces_expires_at_idx
    ON public.admin_openid_nonces (expires_at);