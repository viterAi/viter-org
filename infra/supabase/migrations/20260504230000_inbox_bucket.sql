-- 009 · `inbox` bucket — drop point for incoming WhatsApp zips.
--
-- A zip lands here → Storage webhook → inbox-webhook Edge Function → Trigger.dev ingest-zip.
-- Bytes are read once by the Trigger.dev container and never written back; this bucket
-- is effectively a write-once-then-archive zone. Future cleanup job can prune zips
-- once their corresponding ingest_runs row is marked complete.
--
-- Path shape: <tenant_slug>/<chat_slug>/<filename>.zip
-- Bucket size: each WA chat zip ≤ ~250MB historically.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbox',
  'inbox',
  false,
  314572800,                           -- 300 MB per file
  array['application/zip', 'application/x-zip-compressed']
)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- RLS — same channel-membership gate as l0-whatsapp.
-- ────────────────────────────────────────────────────────────────────
-- Members of <chat_slug> can upload zips for that chat.
-- Service role bypasses RLS.

create policy if not exists inbox_member_upload
  on storage.objects
  for insert
  with check (
    bucket_id = 'inbox'
    and (
      -- path shape: <tenant_slug>/<chat_slug>/<filename>.zip
      array_length(string_to_array(name, '/'), 1) >= 3
    )
    and exists (
      select 1
        from public.tenants t
        join public.channels c on c.tenant_id = t.id
       where t.slug = (string_to_array(name, '/'))[1]
         and c.kind = 'whatsapp'
         and c.identifier = (string_to_array(name, '/'))[2]
         and public.user_can_read_channel(c.id)
    )
  );

create policy if not exists inbox_member_read
  on storage.objects
  for select
  using (
    bucket_id = 'inbox'
    and exists (
      select 1
        from public.tenants t
        join public.channels c on c.tenant_id = t.id
       where t.slug = (string_to_array(name, '/'))[1]
         and c.kind = 'whatsapp'
         and c.identifier = (string_to_array(name, '/'))[2]
         and public.user_can_read_channel(c.id)
    )
  );
