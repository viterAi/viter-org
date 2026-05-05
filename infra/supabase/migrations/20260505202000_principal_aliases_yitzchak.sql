-- 013 · Principal alias migration — Yitzchak across 4 spellings + GitHub + email.
--
-- Discovered during the per-person zoom-in: Yitzchak's L1 events have
-- actor_id=null because the parser sees "Yitchak Shaul Levin" (his WA contact)
-- but the principal canonical_id is `yitzchak-brown`. He also shows up as
-- "Issac Brown" / "Issac Browm" / "Epikaai" in GitHub commits and `yy@upvlu.com`
-- in email. Same person — just no alias resolution.
--
-- This migration adds his known aliases to principals.identifiers (jsonb gin-indexed).
-- Future ingest passes can match against any of these strings.
--
-- Idempotent: extends the array, doesn't overwrite. Applies only if the
-- principal exists. Safe to re-run.

update public.principals
   set identifiers = (
     select jsonb_agg(distinct value)
       from jsonb_array_elements(
         coalesce(identifiers, '[]'::jsonb) || '[
           "Yitchak Shaul Levin",
           "yitchak shaul levin",
           "Yitzchak",
           "yitzchak",
           "Yitschak",
           "yitschak",
           "Yitzhak",
           "yitzhak",
           "Yitchak",
           "yitchak",
           "Issac Brown",
           "issac brown",
           "Issac Browm",
           "Epikaai",
           "epikaai",
           "ohrbot613",
           "yy@upvlu.com",
           "Yuskak"
         ]'::jsonb
       )
   ),
   metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
     'aliases_added_at', now(),
     'github_handles', array['ohrbot613'],
     'github_commit_names', array['Issac Brown', 'Issac Browm', 'Epikaai'],
     'whatsapp_contact_name', 'Yitchak Shaul Levin',
     'whisper_renderings', array['Yuskak','Yitschak','Yitzhak'],
     'note', '4-system identity reconciliation per zoom-in 2026-05-05'
   )
 where canonical_id = 'yitzchak-brown';
