-- 016 · Phone aliases for Jeffrey + Yitzchak; rename their direct channels
-- to wa-<phone> so live GOWA inbound unifies with the existing zip-ingest
-- l1_events instead of creating a parallel duplicate channel.
--
-- Already applied to vita prod (dkccadwohifcqcdzhhnu) via MCP.

-- Jeffrey: +972 54-666-8182
update public.principals
   set identifiers = (
     select jsonb_agg(distinct value)
       from jsonb_array_elements(
         coalesce(identifiers, '[]'::jsonb) || '[
           "972546668182", "+972546668182", "972546668182@s.whatsapp.net",
           "Jeffrey", "jeffrey", "Jeffrey Levine", "jeffrey levine"
         ]'::jsonb
       )
   ),
   metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
     'phone_e164', '+972546668182',
     'whatsapp_jid', '972546668182@s.whatsapp.net',
     'aliases_added_at', now()
   )
 where canonical_id = 'jeffrey-levine';

-- Yitzchak: +972 55-263-1180 (text aliases were added in migration 013)
update public.principals
   set identifiers = (
     select jsonb_agg(distinct value)
       from jsonb_array_elements(
         coalesce(identifiers, '[]'::jsonb) || '[
           "972552631180", "+972552631180", "972552631180@s.whatsapp.net"
         ]'::jsonb
       )
   ),
   metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
     'phone_e164', '+972552631180',
     'whatsapp_jid', '972552631180@s.whatsapp.net',
     'phone_aliases_added_at', now()
   )
 where canonical_id = 'yitzchak-brown';

update public.channels
   set identifier = 'wa-972546668182',
       display_name = 'WhatsApp · Jeffrey Levine',
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'source', 'wa-zip-ingest',
         'chat_id', '972546668182@s.whatsapp.net',
         'is_group', false,
         'principal_id', 'da66f06e-7e64-48af-9564-daab1ad3e9b5',
         'principal_canonical_id', 'jeffrey-levine',
         'renamed_from', 'jeffrey-direct',
         'renamed_at', now()
       )
 where identifier = 'jeffrey-direct';

update public.channels
   set identifier = 'wa-972552631180',
       display_name = 'WhatsApp · Yitzchak Brown',
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'source', 'wa-zip-ingest',
         'chat_id', '972552631180@s.whatsapp.net',
         'is_group', false,
         'principal_id', '99d2785a-6d75-41ea-b4f4-0f4878fe455f',
         'principal_canonical_id', 'yitzchak-brown',
         'renamed_from', 'yitzchak-direct',
         'renamed_at', now()
       )
 where identifier = 'yitzchak-direct';

update public.channels
   set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
     'principal_id', '7f17cd49-6091-4b52-aea1-0f2662e3412e',
     'principal_canonical_id', 'shaul-levine'
   )
 where identifier = 'wa-972533145330';
