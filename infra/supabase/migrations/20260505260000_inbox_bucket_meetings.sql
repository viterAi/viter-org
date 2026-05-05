-- 018 · inbox bucket — accept meeting audio at <tenant>/meetings/<slug>/<file>.<ext>
--
-- The existing inbox bucket (migration 009) was zip-only: 4-part allowlist
-- (`application/zip`, `application/x-zip-compressed`) and 3-part path RLS
-- (<tenant>/<chat>/<file>.zip → whatsapp channel gate).
--
-- This migration:
--   1. Extends `allowed_mime_types` to cover meeting audio (m4a/mp3/wav/mp4/opus/ogg).
--   2. Bumps `file_size_limit` from 300 MB → 500 MB to fit longer recordings.
--   3. Adds RLS policies for the 4-part meeting path:
--        <tenant>/meetings/<slug>/<file> → meeting channel gate.
--      Existing 3-part WhatsApp policies are left in place.
--
-- Path-shape routing happens in the inbox-webhook Edge Function, not in RLS;
-- the policies here exist to gate human upload via the apps/web UI when that
-- surface lands (currently uploads are service-role from scripts/CLI).

-- ────────────────────────────────────────────────────────────────────
-- 1. Bucket config — broader mime types + larger ceiling
-- ────────────────────────────────────────────────────────────────────

update storage.buckets
   set file_size_limit = 524288000,                 -- 500 MB
       allowed_mime_types = array[
         -- existing zip MIMEs
         'application/zip',
         'application/x-zip-compressed',
         -- audio
         'audio/m4a',
         'audio/mp4',
         'audio/x-m4a',
         'audio/mpeg',
         'audio/mp3',
         'audio/wav',
         'audio/x-wav',
         'audio/ogg',
         'audio/opus',
         -- video (recordings sometimes land as mp4)
         'video/mp4',
         'video/quicktime'
       ]
 where id = 'inbox';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS — 4-part meeting path: <tenant>/meetings/<slug>/<file>
-- ────────────────────────────────────────────────────────────────────
-- Co-exists with the existing 3-part WhatsApp policies (009). A path
-- matches at most one shape, so the gates compose without conflict.

drop policy if exists inbox_meeting_member_upload on storage.objects;
create policy inbox_meeting_member_upload
  on storage.objects
  for insert
  with check (
    bucket_id = 'inbox'
    and (string_to_array(name, '/'))[2] = 'meetings'
    and array_length(string_to_array(name, '/'), 1) >= 4
    and exists (
      select 1
        from public.tenants t
        join public.channels c on c.tenant_id = t.id
       where t.slug = (string_to_array(name, '/'))[1]
         and c.kind = 'meeting'
         and c.identifier = (string_to_array(name, '/'))[3]
         and public.user_can_read_channel(c.id)
    )
  );

drop policy if exists inbox_meeting_member_read on storage.objects;
create policy inbox_meeting_member_read
  on storage.objects
  for select
  using (
    bucket_id = 'inbox'
    and (string_to_array(name, '/'))[2] = 'meetings'
    and exists (
      select 1
        from public.tenants t
        join public.channels c on c.tenant_id = t.id
       where t.slug = (string_to_array(name, '/'))[1]
         and c.kind = 'meeting'
         and c.identifier = (string_to_array(name, '/'))[3]
         and public.user_can_read_channel(c.id)
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. Soft-create the meeting channel on first upload
-- ────────────────────────────────────────────────────────────────────
-- The webhook can't create a channel via RLS unless one already exists,
-- because user_can_read_channel returns false for nonexistent channels.
-- Service-role writes (the trigger task) bypass RLS, so the task can
-- create-or-resolve the channel during ingest. RLS above only matters when
-- the eventual UI does direct uploads with the user JWT — at which point
-- the user is expected to have created the channel first via a server action.
-- (No DDL change needed here; just documenting the invariant.)
