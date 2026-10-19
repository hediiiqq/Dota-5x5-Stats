create table public.matches
(
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dota_match_id BIGINT NOT NULL UNIQUE,
    started_at  TIMESTAMPTZ,
    duration  INTEGER,
    game_mode INTEGER,
    lobby_type INTEGER,
    raw_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

