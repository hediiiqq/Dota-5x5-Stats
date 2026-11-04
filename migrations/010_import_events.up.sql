create table public.import_events(
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz not null default now(),
    job_id bigint references public.import_jobs (id) not null ,
    level text check (level = 'info' or level = 'warning' or level = 'error') not null ,
    stage text,
    dota_match_id bigint check ( dota_match_id > 0 ),
    message text not null check ( btrim(message) <> '' )
);

create index import_events_job_id_id_idx
on public.import_events (job_id,id);