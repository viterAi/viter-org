alter table public.sources
add column if not exists markdown text;

update public.sources
set markdown = ''
where markdown is null;

alter table public.sources
alter column markdown set not null;

alter table public.sources
alter column markdown set default '';
