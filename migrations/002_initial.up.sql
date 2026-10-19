create table public.match_players
(
    match_id bigint references public.matches(id),
    account_id bigint,
    nickname text,
    team_number integer check ( team_number = 1 or team_number = 0 ),
    hero_id integer,
    kills integer,
    deaths integer,
    assists integer,
    primary key (match_id,account_id)
);
