create table public.import_jobs(
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id text references public.import_accounts(id) not null ,
    account_name text not null ,
    mode text check ( mode = 'history' or mode ='incremental' ) not null ,
    min_match_id bigint,
    after_match_id bigint,
    status text check  ( status = 'queued' or status = 'running' or status = 'succeeded' or status = 'failed' ) not null DEFAULT 'queued' ,
    stage text check ( stage = 'steam_connect' or stage = 'awaiting_guard' or stage = 'gc_connect' or stage = 'history' or stage = 'details' or stage ='saving' ),
    created_at timestamptz default now() not null ,
    started_at timestamptz default null,
    finished_at timestamptz,
    updated_at timestamptz default now() not null,

    discovered bigint not null  default 0 check ( discovered >=0 ),
    saved bigint not null  default 0 check ( saved >=0 ),
    existing bigint not null  default 0 check ( existing >=0 ),
    filtered bigint not null  default 0 check ( filtered >=0 ),
    failed bigint not null  default 0 check ( failed >=0 ),

    error_code text,
    error_message text,

    check ( mode = 'history' and min_match_id is not null and min_match_id > 0 and after_match_id is null or mode = 'incremental' and min_match_id is null and after_match_id is not null and after_match_id >  0 ),
    check ( status = 'running' or stage is null )
);

create UNIQUE index import_jobs_one_active_per_account
on public.import_jobs (account_id) where status = 'queued' or status = 'running';

insert into public.import_accounts(id) values ('account1'), ('account2') on conflict (id) do nothing ;