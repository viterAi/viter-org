# Functional Comparison Issues — Gui vs vita-compare

> Generated 2026-05-06. Two sections: (A) features vita-compare ships that Gui is missing, (B) Gui-internal wiring gaps where the code exists but is disconnected or dead.

---

## Section A — Functional capabilities vita has; Gui does not

---

### Issue A1 — End-user authentication (email OTP + session)

**Labels:** `feature` `size:M`
**Assignee:** _unassigned_

#### What
Add a `/login` route with email OTP sign-in and a `/auth/callback` exchange so unauthenticated users cannot access the app.

#### Why
Gui has no auth layer at all. Any URL renders the full app to any visitor. vita-compare ships email OTP via Resend + Supabase magic-link, a `/auth/callback` PKCE exchange, and a `POST /auth/signout` route. Without auth, Gui cannot be exposed beyond localhost.

#### Acceptance criteria
- [ ] `POST /api/auth/send-otp` sends a 6-digit OTP to the submitted email via Resend
- [ ] `POST /api/auth/verify-otp` exchanges the code for a Supabase session cookie
- [ ] `GET /auth/callback` handles magic-link PKCE code exchange (`@supabase/ssr`)
- [ ] `POST /auth/signout` tears down the session and redirects to `/login`
- [ ] `middleware.ts` redirects unauthenticated requests to `/login`
- [ ] `lib/supabase/server.ts` is updated to use cookie-based client (`@supabase/ssr`)

#### Notes
vita reference: `apps/web/app/login/`, `apps/web/app/auth/callback/route.ts`, `apps/web/app/auth/signout/route.ts`, `apps/web/lib/supabase/`.
Requires adding `@supabase/ssr` and `resend` to `package.json`. Env vars needed: `RESEND_API_KEY`, `RESEND_FROM`, optional `AUTH_EMAIL_ALLOWLIST`.
The existing `lib/supabase/server.ts` uses anon key but no cookie session — needs replacing.

#### Scope
_To be filled in before work starts._

---

### Issue A2 — Multi-tenancy: tenants and tenant membership

**Labels:** `feature` `size:L`
**Assignee:** _unassigned_

#### What
Introduce a `tenants` table and `tenant_members` join, and thread a `tenant_id` filter through all API queries so data is scoped per tenant.

#### Why
Gui has no tenant isolation — all sources and views in the DB are visible to every session. vita-compare has a full multi-tenant schema (`tenants`, `tenant_members`, RLS policies) with a `getCurrentTenantId()` waterfall. Without this, Gui cannot be used by more than one customer and cannot enforce data boundaries.

#### Acceptance criteria
- [ ] `tenants` and `tenant_members` tables added via migration with RLS enabled
- [ ] `getCurrentTenantId()` helper resolves tenant from session → `tenant_members` row → `VITA_DEFAULT_TENANT_SLUG` fallback
- [ ] `sources`, `views`, `view_versions`, `view_drafts`, `view_events` all have `tenant_id` FK and RLS policies
- [ ] All API routes (`/api/sources`, `/api/views/**`) filter by resolved `tenant_id`
- [ ] Existing rows in dev/staging assigned to a default tenant without data loss

#### Notes
vita reference: `apps/web/lib/supabase/server.ts` `getCurrentUser` / `getCurrentTenantId`, migrations `20260504100000_l0_substrate.sql`, `20260505250000_tenant_members_rls_cutover.sql`.
This is a breaking schema change — plan migration carefully. Depends on A1 (auth must exist to resolve a tenant).

#### Scope
_To be filled in before work starts._

---

### Issue A3 — Real-time data: Supabase `postgres_changes` subscription

**Labels:** `feature` `size:M`
**Assignee:** _unassigned_

#### What
Add a `useRealtimeSource` hook that subscribes to `postgres_changes` on the active source's underlying data and re-renders the main panel when new rows arrive.

#### Why
Gui requires a manual reload or re-trigger to see new data. vita-compare's `RealtimeStream` subscribes to `l1_events` in the browser and appends rows live with a "↓ N new" unread pill. For a live operational dashboard (AR follow-up, invoices) this is a core usability requirement.

#### Acceptance criteria
- [ ] `useRealtimeSource(sourceId)` hook subscribes to `postgres_changes` INSERT on `sources` (or the relevant derived table) filtered by `source_id`
- [ ] Main panel re-fetches canvas or refreshes row data on a relevant change without a full page reload
- [ ] A "New data available — refresh" banner appears when the user has scrolled away; auto-refreshes when at top
- [ ] Subscription is cleaned up on source switch and component unmount
- [ ] Tested with a live Supabase row insert in dev

#### Notes
vita reference: `apps/web/app/chat/RealtimeStream.tsx`.
The existing Supabase client (`lib/supabase/server.ts`) is server-only. A browser-side client is needed — `createBrowserClient` from `@supabase/ssr` (once A1 is done) or a lightweight `createClient` for public reads.

#### Scope
_To be filled in before work starts._

---

### Issue A4 — Outbound action loop: send / write-back to source

**Labels:** `feature` `size:L`
**Assignee:** _unassigned_

#### What
Implement a real write-back path so user actions in the UI (e.g. "mark followed up", free-text replies, status updates) persist to the source and re-trigger the canvas pipeline.

#### Why
vita-compare's `Composer` sends outbound messages via GOWA and inserts `l0_artifacts` + `l1_events` optimistically — closing the loop from view to action to new data. In Gui, `POST /api/views/[viewId]/actions` currently returns HTTP 410 ("write-back disabled in markdown-only mode"). The follow-up kanban, aging table "Mark followed up" button, and action panel component all render but do nothing. This is the most visible functional gap for actual users.

#### Acceptance criteria
- [ ] `POST /api/views/[viewId]/actions` with `mark_followed_up` writes `follow_up_status` back to the source row (in `sources.markdown` or a derived table — decision to be made in scope)
- [ ] The UI reflects the updated status without a full canvas re-run
- [ ] `action_panel` component's buttons wire up to the actions API
- [ ] At least one action type (`mark_followed_up`) is fully end-to-end tested

#### Notes
Current stub in `app/api/views/[viewId]/actions/route.ts` — always returns 410.
The architectural decision (write back to `sources.markdown` vs introduce a separate `events` table vs both) must be resolved in scope before any code starts. vita's `l0_artifacts` + `l1_events` pattern is a possible model.

#### Scope
_To be filled in before work starts._

---

## Section B — Gui-internal wiring gaps (code exists but is disconnected)

---

### Issue B1 — Wire view list: load `views` and populate `activeView` on source select

**Labels:** `bug` `size:S`
**Assignee:** _unassigned_

#### What
`GET /api/sources/[sourceId]/views` exists and works, but `app/page.tsx` never calls it. `views` stays `[]` and `activeView` is always `null`, so the legacy `aging_table` / `follow_up_kanban` UI paths never execute.

#### Why
The entire non-AI view rendering branch (KPI strip, aging table, follow-up kanban) is gated on `activeView !== null`. Without fetching the view list on source change, that branch is permanently dead and the DB view schema is unused. This is likely unintentional.

#### Acceptance criteria
- [ ] On source selection, `GET /api/sources/[sourceId]/views` is fetched and `views` state is populated
- [ ] `activeView` is set to the `is_default` view if one exists
- [ ] The aging table and follow-up kanban render correctly when a non-AI view is active
- [ ] AI page tabs still take precedence when AI pages are available

#### Notes
The fetch is simply missing from `app/page.tsx`. The API route at `app/api/sources/[sourceId]/views/route.ts` is implemented and tested. This is a one-fetch fix.

#### Scope
_Can skip — small and obvious._

---

### Issue B2 — Wire draft banner: populate `pendingDraft` and enable "Apply draft"

**Labels:** `bug` `size:S`
**Assignee:** _unassigned_

#### What
The "Apply draft" warning banner in `app/page.tsx` is gated on `pendingDraft !== null`, but `setPendingDraft` is never called anywhere in the component. The `POST /api/views/[viewId]/apply` route is fully implemented but unreachable from the UI.

#### Why
`view_drafts` are created by the canvas pipeline (AI generates a new layout spec as a draft) but the UI never surfaces them for approval. The apply→version workflow that enforces `ensureSpecQuality` → `view_versions` insert → mark draft `applied` is completely bypassed.

#### Acceptance criteria
- [ ] When the canvas SSE stream emits a pending draft, `setPendingDraft` is called with the draft payload
- [ ] The "Apply draft" banner renders with the draft summary
- [ ] Clicking "Apply draft" calls `POST /api/views/[viewId]/apply` with the `draftId`
- [ ] On success the banner dismisses and the view reloads with the new spec

#### Notes
The SSE payload shape from `canvas/route.ts` needs to be checked — it may already emit draft metadata that the client ignores. `view-builder.ts` types include `pending_draft`. Cross-check the `SourceCanvasLoadResponse` type vs what `canvas/route.ts` actually streams.

#### Scope
_Can skip — small once SSE payload is confirmed._

---

### Issue B3 — Remove dead AI code: `generateTableSpecWithOpenRouter` and `validateSpecAgainstCatalog`

**Labels:** `chore` `size:S`
**Assignee:** _unassigned_

#### What
`lib/ai/openrouter.ts` exports `generateTableSpecWithOpenRouter` and `lib/layout/component-catalog.ts` exports `validateSpecAgainstCatalog`. Neither is imported or called anywhere in the codebase.

#### Why
Dead code adds noise, misleads future developers about the AI path, and carries maintenance burden (they import types that may drift). The current canvas flow uses `page-composer.ts` exclusively.

#### Acceptance criteria
- [ ] `generateTableSpecWithOpenRouter` removed from `lib/ai/openrouter.ts` (or entire file removed if nothing else is used)
- [ ] `validateSpecAgainstCatalog` removed from `lib/layout/component-catalog.ts`
- [ ] No TypeScript errors after removal
- [ ] A short code comment in `page-composer.ts` notes it is the single AI entrypoint

#### Notes
Confirm with `rg` before deleting — search for both function names across the full repo to rule out any dynamic/string references.

#### Scope
_Can skip — trivial chore._
