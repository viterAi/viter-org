-- 005 · Bootstrap seed: viter tenant + named principals + initial channels
--
-- Idempotent (ON CONFLICT) so this migration is safe to re-run. Names are
-- canonical-IDs that extractors will reference. tenant_memberships are NOT
-- seeded here — those land when each user signs up via magic-link.

-- ────────────────────────────────────────────────────────────────────
-- TENANT — viter
-- ────────────────────────────────────────────────────────────────────

insert into public.tenants (slug, display_name, metadata) values
  ('viter', 'Viter', '{"founded": "2026-04", "first_pilot_client": "insperanto"}'::jsonb)
on conflict (slug) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- PRINCIPALS — humans + LLMs
-- ────────────────────────────────────────────────────────────────────

with t as (select id as tenant_id from public.tenants where slug = 'viter')
insert into public.principals (tenant_id, canonical_id, display_name, kind, identifiers, metadata)
select t.tenant_id, p.canonical_id, p.display_name, p.kind, p.identifiers::jsonb, p.metadata::jsonb
  from t,
       (values
         ('mordechai-potash',  'Mordechai Potash',  'human',  '["mordechaipotash@gmail.com","mordechai@viter.ai"]', '{"role": "engineer", "company": "viter"}'),
         ('shaul-levine',      'Shaul Levine',      'human',  '["shaul@viter.ai"]',                                  '{"role": "founder", "company": "viter"}'),
         ('jeffrey-levine',    'Jeffrey Levine',    'human',  '["jlevine@insperanto.com","jefflevine@insperanto.com"]', '{"role": "CFO", "company": "insperanto", "qualifications": ["ICAEW","SAICA"]}'),
         ('yitzchak-brown',    'Yitzchak Brown',    'human',  '["yitzchak@viter.ai","issac@viter.ai"]',              '{"role": "infrastructure", "company": "viter"}'),
         ('claude-opus-4-7',   'Claude Opus 4.7',   'llm',    '["anthropic:claude-opus-4-7"]',                       '{"vendor": "anthropic"}'),
         ('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'llm',    '["anthropic:claude-sonnet-4-6"]',                     '{"vendor": "anthropic"}'),
         ('gpt-5',             'GPT-5',             'llm',    '["openai:gpt-5"]',                                    '{"vendor": "openai"}'),
         ('gemini-3-pro',      'Gemini 3 Pro',      'llm',    '["google:gemini-3-pro"]',                             '{"vendor": "google"}'),
         ('vita-system',       'Vita System',       'system', '[]',                                                  '{}')
       ) as p(canonical_id, display_name, kind, identifiers, metadata)
on conflict (tenant_id, canonical_id) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- CHANNELS — surfaces we already know about
-- ────────────────────────────────────────────────────────────────────

with t as (select id as tenant_id from public.tenants where slug = 'viter')
insert into public.channels (tenant_id, kind, identifier, display_name, metadata)
select t.tenant_id, c.kind, c.identifier, c.display_name, c.metadata::jsonb
  from t,
       (values
         ('claude-code',     'viter-platform',   'Claude Code · viter-workspace',                          '{"cwd": "/Users/mordechai/viter-workspace"}'),
         ('claude-code',     'vita',             'Claude Code · vita monorepo',                            '{"cwd": "/Users/mordechai/viter-workspace/vita"}'),
         ('claude-code',     'viter-app',        'Claude Code · viter Next.js app',                        '{"cwd": "/Users/mordechai/viter-workspace/code"}'),
         ('whatsapp',        'viter-internal',   'WhatsApp · Viter (Mordechai+Shaul+Yitzchak)',            '{}'),
         ('whatsapp',        'viter-team',       'WhatsApp · Viter team (incl. Jeffrey)',                  '{}'),
         ('whatsapp',        'shaul-direct',     'WhatsApp · Mordechai ↔ Shaul direct',                    '{}'),
         ('whatsapp',        'jeffrey-direct',   'WhatsApp · Mordechai ↔ Jeffrey direct',                  '{}'),
         ('vita-chat',       'default',          'Vita in-app chat (default thread)',                      '{}'),
         ('email',           'mordechai-inbox',  'Email · mordechaipotash@gmail.com',                      '{}')
       ) as c(kind, identifier, display_name, metadata)
on conflict (tenant_id, kind, identifier) do nothing;
