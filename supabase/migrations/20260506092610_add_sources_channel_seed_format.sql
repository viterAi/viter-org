alter table public.sources
add column if not exists channel text;

update public.sources
set channel = 'manual_upload'
where channel is null;

alter table public.sources
alter column channel set not null;

alter table public.sources
drop constraint if exists sources_channel_check;

alter table public.sources
add constraint sources_channel_check
check (channel in ('whatsapp', 'email', 'portal', 'manual_upload'));

alter table public.sources
add column if not exists seed_format text;

update public.sources
set seed_format = 'markdown'
where seed_format is null;

alter table public.sources
alter column seed_format set not null;

alter table public.sources
alter column seed_format set default 'markdown';

alter table public.sources
drop constraint if exists sources_seed_format_check;

alter table public.sources
add constraint sources_seed_format_check
check (seed_format in ('markdown', 'json', 'csv'));
