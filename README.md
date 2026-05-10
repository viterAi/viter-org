# Vita — Autonomous View Builder

A **Next.js 16 + React 19 + Supabase** shell that renders AI-generated, multi-page
view layouts from L0 message sources. It models the platform's three-layer UI
(**Murmur** top bar / **Surface** canvas / **Dock** steer panel) and persists view
specs, versions, and drafts to Supabase.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Framer Motion |
| Language | TypeScript (strict, ES2022) |
| Database / Auth | Supabase (`@supabase/ssr`) |
| AI | OpenRouter HTTP API + Zod |
| Lint / types | `tsc --noEmit` (via `npm run typecheck` / `npm run lint`) |

---

## Setup

### 1. Environment variables

Copy the template and fill in your credentials:

```bash
cp .env.example .env.local
```

The app uses **`L0_`-prefixed** variable names throughout. Make sure all seven
variables are set:

| Variable | Used in |
|---|---|
| `NEXT_PUBLIC_L0_SUPABASE_URL` | Browser Supabase client |
| `NEXT_PUBLIC_L0_SUPABASE_ANON_KEY` | Browser Supabase client |
| `L0_SUPABASE_URL` | Server Supabase client, middleware |
| `L0_SUPABASE_ANON_KEY` | Server Supabase client, middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client (bypasses RLS) |
| `OPENROUTER_API_KEY` | AI canvas generation |
| `OPENROUTER_MODEL` | AI canvas generation (default: `google/gemini-2.0-flash-001`) |

> **Note:** The old `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
> names are **not used** anywhere in the codebase. Use the `L0_` names above.

### 2. Database

Apply the schema to your Supabase project. You can either:

- Run the full schema manually:
  ```bash
  # paste contents of supabase/schema.sql into the Supabase SQL editor
  ```
- Or use the Supabase CLI with migrations:
  ```bash
  supabase db push
  ```

Tables created: `sources`, `views`, `view_versions`, `view_drafts`, `view_events`,
`tenant_memberships`.

### 3. Install & run

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # start production server
npm run typecheck  # tsc --noEmit (also runs as 'lint')
```

---

## Project structure

```
app/
  page.tsx              # Main shell (Murmur + LeftSidebar + TabBar + CanvasContent + Dock)
  layout.tsx            # Root layout — TokenProvider, UserProvider
  login/page.tsx        # Login page
  api/
    bootstrap/          # GET  — session info (userId, email, tenantId, role)
    sources/            # GET  — list sources (mock L0 chats)
    sources/[sourceId]/
      canvas/           # GET  — SSE stream: AI multi-page layout generation
      views/            # GET / POST — list / create views for a source
    views/[viewId]/
      apply/            # POST — apply spec, insert view_versions, update views
      actions/          # POST — write-back stub (returns 410 in markdown-only mode)
    canvas/refresh/     # GET  — canvas refresh helper
    steer/              # POST — steer hint submission

lib/
  ai/
    openrouter.ts       # Deprecated — was table-spec generation; superseded by page-composer.ts
    page-composer.ts    # Single AI entrypoint: plans pages + fills components with abstract ViewSpec nodes
  auth/UserContext.tsx  # useUser() — loads tenant via /api/bootstrap
  layout/
    component-catalog.ts  # Allowed components, validation, AI prompt block
  l0/mock-data.ts       # MOCK_CHATS + MOCK_MESSAGES (drives sidebar & canvas)
  supabase/
    browser.ts          # createBrowserClient (NEXT_PUBLIC_L0_ vars)
    server.ts           # createServerClient (L0_ vars)
    admin.ts            # createClient with service role (bypasses RLS)
  types/
    spec.ts             # Abstract view spec TypeScript model
    view-builder.ts     # Persisted view / row types
  view/
    spec-mapper.ts      # Maps abstract nodes → concrete component IDs
    spec-quality.ts     # Normalization / quality pass before apply
  source-data/
    parse-source-data.ts  # Source data parsing (markdown / JSON / CSV)

middleware.ts           # Supabase SSR session refresh; redirect to /login or 401
supabase/
  schema.sql            # Full DDL
  migrations/           # Incremental SQL migrations
docs/                   # PRDs, spec format, integration plan, design tokens, skill tickets
data/
  source-datasets.md    # Canonical source + invoice seed tables
```

---

## Authentication

All routes (UI and API) pass through `middleware.ts`, which:

- Refreshes the Supabase session on every request.
- Redirects unauthenticated UI requests to `/login`.
- Returns `401 { error: "unauthenticated" }` for unauthenticated API requests.
- Redirects authenticated users away from `/login` to `/`.

---

## API reference

### `GET /api/bootstrap`
Returns session info for the logged-in user.

```json
{ "userId": "...", "email": "...", "tenantId": "...", "role": "..." }
```

> `POST /api/bootstrap` returns **405** (seed endpoint is disabled).

### `GET /api/sources`
Returns the list of available sources (currently backed by `MOCK_CHATS` in
`lib/l0/mock-data.ts`).

### `GET /api/sources/:sourceId/canvas`
Streams an **SSE** response. Loads mock messages for the `chatSlug`, runs
`planPages` then `fillPageComponents` (via OpenRouter), and emits layout events
as they complete.

### `GET /api/sources/:sourceId/views`
Lists all `views` rows in Supabase for the given source and tenant.

### `POST /api/sources/:sourceId/views`
Creates a new view row for the source.

```json
{ "name": "My View", "view_type": "spatial" }
```

### `POST /api/views/:viewId/apply`
Applies a new spec to a view:
1. Inserts a row into `view_versions`.
2. Updates `views.spec` and `views.current_spec_version`.
3. Optionally writes to `view_drafts`.

### `POST /api/views/:viewId/actions`
Write-back stub. Currently returns **410** (disabled in markdown-only mode).

---

## Key concepts

### Three-layer UI
| Layer | Component | Role |
|---|---|---|
| Murmur | `app/components/Murmur.tsx` | Top bar — global nav / context |
| Surface | `app/components/CanvasContent.tsx` | Center canvas — rendered view |
| Dock | `app/components/Dock.tsx` | Bottom panel — steer / config |

### Abstract view spec
`lib/types/spec.ts` defines the v1 spec model — renderer-agnostic nodes
(`metric_summary`, `ranked_list`, `breakdown`, `trend`, etc.). `lib/view/spec-mapper.ts`
translates those abstract nodes to concrete catalog component IDs at render time.
`lib/view/spec-quality.ts` normalises specs before they are persisted.

`lib/ai/page-composer.ts` is the single AI entrypoint: `planPages` decides which
pages to create; `fillPageComponents` prompts the AI for abstract ViewSpec nodes,
then pipes them through the spec-mapper. `lib/ai/openrouter.ts` is deprecated
(old table-spec path, no longer called).

### Mock data
`lib/l0/mock-data.ts` exports `MOCK_CHATS` and per-key `MOCK_MESSAGES`. These
drive the sidebar source list and the canvas generation pipeline until live L0
data is wired in.

---

## Nested workspace — `vita-compare/`

The `vita-compare/` subdirectory is a **separate pnpm + Turbo monorepo** for the
broader Vita platform (SHELET L0→L1→L2→L3 pipeline, WhatsApp ingestion, adapters,
Edge Functions). It has its own Supabase project and is built/run independently:

```bash
cd vita-compare
pnpm install
pnpm dev
```

---

## Further reading

- `docs/spec-format.md` — full v1 abstract spec reference
- `docs/prd-view-builder-v2.md` — product requirements
- `docs/integration-plan.md` — rendering layer integration with L2 syntheses
- `docs/auth-and-data-access.md` — RLS model, tenant helpers, policy table
- `docs/design-tokens.md` — token architecture and CSS variables
- `docs/skills/000-INDEX.md` — skill ticket index (T-001 → T-022)
- `CHECKLIST.md` — requirements checklist v2
