create table public.site_notices(
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    text text not null CHECK (char_length(btrim(text)) BETWEEN 1 AND 500)
);