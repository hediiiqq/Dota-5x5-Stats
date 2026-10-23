CREATE TABLE public.match_metadata
(
    match_id bigint references public.matches(id) primary key ,
    raw_data JSONB NOT NULL,
    updated_at timestamptz not null default now()
);