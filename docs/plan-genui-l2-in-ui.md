# Plan — genUI L2 in the UI (per-user)

**Owner:** Issac Brown · **Status:** in progress · **Started:** May 12, 2026
**Branch:** `feat/genui-l2-in-ui` · **Tracker:** `CHECKLIST.md` §17

---

## 1. Goal

Replace the mock chat/feed data that currently powers the left sidebar and canvas with real `public.genui_l2` rows from Supabase, scoped per signed-in user via the existing RLS policies. The visible work product: when a user signs in, the sidebar lists the channels they (or their tenant) have connected via the "Corn jobs" flow, and clicking a channel renders an AI-generated view over that channel's L2 synthesis rows.

This is the data swap behind the existing canvas — *not* a new surface, *not* a new AI pipeline.

---

## 2. Decisions log

| # | Decision | Choice |
|---|---|---|
| Q1 | Read scope | Tenant by default (RLS); `?mine=1` reserved for own-private slice |
| Q2 | Sidebar shape | Existing channel-group tree, leaves are `genui_channels` |
| Q3 | Canvas flow | Existing `loadOrGenerate` — saved layout + content refresh |
| Q4 | DB client | `getSupabaseServerClient()` (SSR + RLS) for reads |
| Q5 | Mock data | Deleted — no fallback path |
| Q6 | Source identity | `{ id: stable-key, key: stable-key, channel, name }`; channel UUID resolved server-side |
| Q7 | Row contract to AI | Raw `payload` pass-through + `{ id, created_at, channel }` envelope |
| Q8 | Row cap | `min(latest N, last D days)`; envs `GENUI_L2_MAX_ROWS=100`, `GENUI_L2_MAX_DAYS=30` |
| Q9 | Empty states | 3 distinct — no channels / no rows / privacy-hidden |
| Q10 | Seeding | None — use live DB; real ingest populates more |
| Q11 | Freshness | Poll on focus + slow interval (≈30s) |
| Q12 | v1 scope | Everything above except Supabase Realtime (replaced by polling) and the optional `?mine=1` toggle |

---

## 3. Data model recap

`public.genui_channels` (UI project does not own this; lives in L0 Supabase) —
one row per connected service. Unique on `(tenant_id, source, external_key)`.

`public.genui_l2` — one synthesis row per ingest event. Holds `tenant_id`,
`genui_channel_id`, `created_by`, `visibility` ∈ `{'private','tenant'}`, and a
free-form `payload jsonb` produced by the synthesizer.

RLS (already deployed, migration `20260513120000_genui_l2_created_by_visibility.sql`)
makes every read on `genui_l2` automatically respect tenant membership +
visibility + ownership. Our server code passes the user's JWT through the SSR
Supabase client and trusts the policies.

`public.views.source_id` is `text` (not uuid) — the stable composite key fits in
without a migration.

---

## 4. Architecture changes

### 4.1 The stable source key (Q6)

The frontend `Source.id` was previously a mock string like `"shaul-direct"`.
Now it is a composite **stable key** of the form `<source>:<external_key>`,
e.g. `gmail:yy@upvlu.com`, `github:vita-compare/vita`. The key is what:

- The browser stores in `localStorage` (`gui:sourceId`).
- The route URL carries (`/api/sources/[sourceId]/canvas`).
- `public.views.source_id` persists for "default view" lookup.

The channel UUID is resolved **server-side** on every request via
`genui_channels where source = ? and external_key = ?` under RLS. If the row
is gone (channel deleted) the route returns a 404; the frontend falls back to
the first available source.

### 4.2 Row contract to the AI page-composer (Q7)

`/api/sources/[sourceId]/canvas` and `…/canvas/refresh` and `…/steer` each
read up to `GENUI_L2_MAX_ROWS` (default 100) rows from the last
`GENUI_L2_MAX_DAYS` (default 30) days, newest first.

Each row is flattened to:

```ts
{ ...payload, id: <l2.id>, created_at: <l2.created_at>, channel: <channels.source> }
```

`planPages` / `fillPageComponents` already accept `SourceDataRow = Record<string, Json>`,
so no `lib/ai/*` changes are required. The prompt already includes
`source.channel` and `source.name`, so channel-awareness is free.

### 4.3 Polling (Q11)

`useCanvas` adds a focus + interval listener (≈30s) that re-fires the existing
`runContentRefresh(sourceId, aiPages, "data_change")`. Layout stays cached;
only dynamic components re-evaluate. No Realtime channel.

Poll-driven ticks enforce a **10s minimum gap** so rapid focus/visibility
events do not stack OpenRouter calls. The TabBar **Refresh** button calls the
same refresh path **without** this throttle so explicit user actions always run.

**Saved-layout load:** after restoring `ai_pages` from `public.views`, we **do
not** immediately call `runContentRefresh`. Legacy `text_block` components are
still treated as “dynamic” by the refresh route; auto-refresh on every reload
would re-run the LLM for every block. Freshness is polling + manual refresh only.

### 4.4 Empty states (Q9)

- **No channels** — sidebar renders an inline "Connect your first service →
  Corn jobs" CTA (and the Corn jobs button at the bottom stays visible).
- **Channel selected, zero L2 rows** — canvas renders
  "No synthesis yet for this channel. Ingest will populate it." with a manual
  refresh button.
- **Channel selected, only private rows from others** — canvas renders
  "Owned by teammates" with copy explaining the row count is hidden by their
  visibility. (Detected by: list `genui_l2` for the channel returns 0 rows
  while the channel itself is visible to the user.)

The third case collapses into the second when scope = tenant default (Q1-B);
it materially differs only once the `?mine=1` toggle is added.

### 4.5 Reload fixes (May 12, 2026)

First ship showed `POST …/canvas/refresh` (6s+) on every full reload and `GET …/invoices` **500** for keys like `gmail:yy@upvlu.com` (route still queried `public.sources` by UUID).

**Mitigations:** no `runContentRefresh` on saved-view restore; `loadingCanvas` hides the “no synthesis” empty state until `loadOrGenerate` completes (avoids accidental `fetchCanvas`); `/invoices` returns L2 rows via `l2-source`; `views/.../actions` import path + Zod `sourceId` accept composite keys.

---

## 5. File-level diff plan

```
A  docs/plan-genui-l2-in-ui.md                 (this file)
A  lib/genui/l2-source.ts                      (helpers: list channels, resolve key, fetch L2 rows)
M  app/types.ts                                (clarify Source.id IS the stable key)
M  app/api/sources/route.ts                    (list real channels via SSR)
M  app/api/sources/[sourceId]/canvas/route.ts  (read genui_l2, drop mocks)
M  app/api/sources/[sourceId]/canvas/refresh/route.ts
M  app/api/sources/[sourceId]/invoices/route.ts (L2 rows for saved-layout hydration)
M  app/api/sources/[sourceId]/steer/route.ts
M  app/api/views/[viewId]/actions/route.ts     (import fix + composite sourceId in schema)
M  app/hooks/useCanvas.ts                      (poll + throttle; loadingCanvas; no refresh on saved load)
M  app/components/LeftSidebar.tsx              (no-channels CTA)
M  app/components/CanvasContent.tsx            (no-rows / privacy-hidden states + loadingCanvas gate)
M  app/page.tsx
D  lib/l0/mock-data.ts                         (the 1000-line mock blob)
M  CHECKLIST.md                                (new §17 with the breakdown)
```

`lib/l0/whatsapp.ts` is untouched — it does not import `mock-data.ts`.

---

## 6. Out of scope (deliberate)

- `?mine=1` UI toggle. The route will silently accept it but no control wires it from the UI.
- Supabase Realtime. Polling is the v1 freshness mechanism.
- Migration of any existing `public.views` rows. Existing rows key off the old mock slugs and will simply not match the new stable keys — they stay orphaned and harmless. (Manual cleanup is easy: `delete from public.views where source_id not like '%:%';`.)
- Per-channel design tokens. Each channel will share the global theme until
  `Source Design Tokens` (CHECKLIST §14) lands.

---

## 7. Done definition (phase 1 — flat channels)

1. Signed-in user with at least one `genui_channels` row sees that channel in the sidebar grouped under its `source` kind.
2. Clicking it triggers an AI generation pass over the latest L2 rows; the resulting layout saves to `public.views` and reloads next time without an AI call.
3. Removing the channel from "Corn jobs" → the sidebar entry disappears on next fetch; existing canvas falls back to the first source.
4. Lints pass; no references to `lib/l0/mock-data` remain in `app/**`.

---

## 8. Phase 2 — AI-inferred grouping under each kind

**Why:** the user wants sidebar leaves to be *senders* (under Gmail), *chats*
(under WhatsApp), *channels* (under Slack), *repositories* (under GitHub), etc.,
and the system to figure out which payload field to group on **per service kind**
so it adapts to any new connector without code changes.

### 8.1 Decisions log (Q1–Q11, May 12, 2026)

| # | Decision | Choice |
|---|---|---|
| Q1 | Group leaves vs. expanders | A — group **is** the leaf. Clicking a sender loads the canvas filtered to that sender. |
| Q2 | Where does grouping config live? | B — `public.genui_kind_grouping` keyed by `kind`, AI infers + caches. |
| Q3 | When does AI run? | B — ingest worker after `genui_l2` inserts, when no grouping exists for the kind. |
| Q4 | Cache row schema | `kind`, `group_field`, `group_label`, `timestamp_field`, `display_regex`, `confidence`, `last_error`. |
| Q5 | Group identity | B — **kind-scoped** stable key `<kind>::<group_field>=<group_value>`; merges across multiple accounts of the same kind. |
| Q6 | API shape | A — single `/api/sources` returns nested `{ tree, sources }`. |
| Q7 | Pre-inference behaviour | A — flat per-channel leaves (today's UI) until a grouping row exists. |
| Q8 | Null/empty group values | B — bucket into an **"Other"** leaf with `is_other: true`, `group_value: "__other__"`. |
| Q9 | LLM fallback | B — retry once, then heuristic fallback (string field present in ≥80 % of sample rows), `confidence: "heuristic"`, log `last_error`. |
| Q10 | Legacy saved views | A — leave orphaned (today's per-channel keys won't match `kind::field=value`). |
| Q11 | Scope | C — full design **plus** Corn-jobs admin UI to re-detect / hand-pick `group_field` / `display_regex`. |

### 8.2 Data model

`public.genui_kind_grouping` (new, global metadata table — RLS-readable by
authenticated, writable by authenticated for v1):

```
kind              text   primary key   -- matches genui_channels.source
group_field       text   not null      -- payload field used for grouping
group_label       text   not null      -- "Sender", "Chat", "Channel"
timestamp_field   text                 -- optional payload field to sort by newest
display_regex     text                 -- optional regex with one capture group → display label
confidence        text   not null      -- 'seed' | 'ai' | 'heuristic' | 'admin'
last_error        text                 -- when LLM inference fails
created_at        timestamptz
updated_at        timestamptz
```

Seeded with `gmail`, `outlook` (`group_field = "from_email"`), `whatsapp`
(`chat_slug`), `slack` (`channel`), `github` (`repo`), `clickup` (`list`).

### 8.3 Key format (Q5)

- **Channel key** (today): `<kind>:<external_key>` — unique per channel row.
- **Group key** (new): `<kind>::<group_field>=<group_value>` — kind-scoped.

The double-colon distinguishes the two. `parseSourceKey()` returns either
`{ type: "channel", source, external_key }` or
`{ type: "group", kind, group_field, group_value }`.

`views.source_id` (text) accepts both. The Zod schema is `min(1)` not `uuid()`.

### 8.4 Routes (all reuse the shared resolver)

`/api/sources` returns:

```ts
{
  sources: Source[]; // flat union (groups when available, channels otherwise)
  tree: SourceTreeNode[]; // [{ kind, label, grouping, groups[], channels[] }]
}
```

`/api/sources/[sourceId]/canvas` (and `…/refresh`, `…/steer`, `…/invoices`):

1. `parseSourceKey(key)` →
2. If `channel`: existing path (resolve to one channel, fetch L2).
3. If `group`: list all visible channels of `kind`, fetch capped L2 rows where
   `payload->>group_field = group_value` (or `is.null` for Other).
4. Hand off to the same AI page-composer with `source = { key, name, channel: kind, seed_format: "genui_l2" }` and the flattened rows.

`/api/genui/kind-grouping` — new admin route (Q11-C):
- `GET` → list all rows (RLS-readable to authenticated).
- `POST { kind, group_field, group_label, timestamp_field?, display_regex? }`
  → upsert with `confidence: "admin"`.
- `POST { kind, re_infer: true }` → clear the row's `confidence` to trigger
  re-inference on next ingest tick.

### 8.5 AI inference (Q3, Q9)

`ensureKindGrouping(supabase, kind, samplePayloads)`:
1. Look up cached row — return immediately if present and `confidence ≠ "stale"`.
2. Send up to 10 anonymised sample payloads + the `kind` to OpenRouter:
   ```
   You see L2 synthesis payloads for the service "<kind>".
   Pick the single payload field that best groups items by the conceptual
   "owner" (sender, chat, channel, repo, list, etc.). Return JSON only:
   { "group_field":"…","group_label":"…","timestamp_field":"…|null","display_regex":"…|null" }
   ```
3. Validate: `group_field` must exist as a string in ≥ 50 % of samples.
4. On validation failure → retry once with sterner instructions.
5. Still failing → heuristic fallback (highest-fill-rate non-id string field),
   `confidence: "heuristic"`, store the LLM's `last_error`.
6. Upsert into `genui_kind_grouping`.

Called from `lib/mail-poll/run-mail-poll.ts` once per channel-run after
`inserted > 0`, with the payloads we just generated.

### 8.6 UI changes

- **`Source` type** stays flat (`id`, `name`, `key`, `channel`). New
  `SourceGroup` and `SourceTreeNode` carry the tree.
- **`LeftSidebar`** receives `tree` instead of just `sources`; renders
  `kind → groups[]`, sorted by `latest_at desc`, with an "Other" leaf when
  there are uncategorised rows. Falls back to today's `kind → channels[]` when
  a kind has no grouping row.
- **Corn jobs** gains a new `GenuiKindGroupingPanel` listing every kind with
  its inferred config + an "Edit" form (`group_field`, `group_label`,
  `display_regex`) + a "Re-detect" button.

### 8.7 Mail-poll payload normalisation

So the SQL filter `payload->>from_email = "alice@x.com"` actually matches, we
extract a normalised `from_email` field at ingest:

```ts
function extractFromEmail(rawFrom: string): string {
  const m = rawFrom.match(/<\s*([^>]+)\s*>/);
  return (m?.[1] ?? rawFrom).toLowerCase().trim();
}
```

`buildFallbackPayload` and the AI-summary path both set `from_email` in the
payload. The seed row in `genui_kind_grouping` references this clean field.

### 8.8 Done definition (phase 2)

1. With at least one `gmail` channel that has ingested rows, the sidebar shows
   "Email" → grouped sender list, newest first.
2. Clicking a sender loads the canvas with only that sender's rows in the
   AI's input context.
3. New connectors (e.g. `clickup`) start with no grouping row → flat channel
   leaves; after the first ingest tick `ensureKindGrouping` fills the row and
   subsequent fetches show the AI-inferred grouping.
4. Corn jobs lists every `genui_kind_grouping` row with editable config; clicking
   "Re-detect" clears it so the next ingest re-runs inference.
5. Failing inference falls back to heuristic; never crashes the sidebar.
