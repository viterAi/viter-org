# GenUI + View Builder → vita-compare — Integration Plan

**Author:** Issac Brown (draft)  
**Last updated:** May 13, 2026  
**Status:** Draft — aligns repo ownership and migration steps; execution details to refine during port  
**Related:** [`docs/integration-plan.md`](./integration-plan.md) (View Builder / platform contract with Mrodchi — different scope)

---

## Purpose

Move **all GenUI-related code and the Gui builder experience** (canvas, views, ingest/admin surfaces, API routes, workers/cron glue) into **`vita-compare`** so that **vita is the canonical shipping monorepo**. The **`Gui`** repo remains useful as **history and reference** during the port; long term, **new GenUI work lands only in vita-compare**.

**Non-goal for this document:** Re-negotiating the SHELET architecture or the separate “Mrodchi / platform” integration contract in `integration-plan.md`.

---

## Preconditions (agreed)

| Assumption | Notes |
|------------|--------|
| **Single Supabase project** | Gui and vita-compare both use the **same** database for `genui_*` (and related) tables so **row-level logic and RLS** stay valid during overlap. |
| **Interim auth** | Each app may keep **its own Next.js auth/session code** temporarily, as long as both ultimately use **Supabase Auth** / JWTs that **RLS expects** (`auth.uid()`, tenant membership, etc.). Unify implementation later; **unify identity store** now. |
| **Stack alignment** | Both use **Next.js ~16.2** and **React 19**, which reduces framework friction vs a cross-major port. |

---

## Target layout (vita-compare)

- **Web app:** `vita-compare/apps/web/app/` — App Router pages, `app/api/**` route handlers, client components.
- **Shared TS (recommended over time):** `vita-compare/packages/*` — e.g. `genui` helpers, webhook verification, types → consumed via `"workspace:*"` from `@vita/web`.
- **Infra:** `vita-compare/infra/supabase/migrations/` — **only one place** for new SQL after cutover (avoid mirroring forever).
- **Automation:** Long-running or scheduled jobs — prefer **`packages/runtime`** (or the pattern vita already uses) + documented cron on the **vita** deployment.

---

## Migration phases (suggested order)

### Phase 1 — Schema and data plane

1. Ensure **all GenUI migrations** present in Gui (`supabase/migrations/` or equivalent) are applied to the **shared** Supabase project in **timestamp order** relative to vita’s existing migrations.
2. When copying SQL into `vita-compare/infra/supabase/migrations/`, use **new timestamps after** the latest migration there so `supabase db` tooling applies a linear history.
3. Verify RLS for **`genui_channels`**, **`genui_l2`**, **`genui_ingest_jobs`**, ownership/visibility, and any **kind grouping** tables match how both apps will query.

### Phase 2 — Server: libraries + route handlers

1. Port **`lib/genui/**`** (and any tightly coupled helpers, e.g. **`lib/mail-poll/**`** if GenUI mail ingest is in scope) into **`apps/web/lib`** and/or **`packages/<name>`**.
2. Port **`app/api/**`** segments used by GenUI (sources, canvas SSE, refresh, GitHub genui ingest, cron endpoints, `genui` config, bootstrap if shared) into **`vita-compare/apps/web/app/api/**`**.
3. **Replace or adapt** Gui-specific imports and **wire tenant/session** using vita’s server helpers (e.g. `getCurrentTenantId()` pattern) so inserts and selects stay tenant-correct.
4. Align **environment variables** in **`vita-compare/.env.example`** and deployment secrets (names may differ from Gui even when values point at the same project).

### Phase 3 — Workers and schedules

1. Decide **one** primary runner for drain/ingest (see **Open decision** below).
2. Move or re-home scripts from Gui (e.g. mail poll, ingest worker) into **`packages/runtime`** or documented `scripts/`, with **`pnpm`**/`turbo` tasks.
3. Point cron / hosted triggers at **vita-compare** URLs or job runner after cutover.

### Phase 4 — UI: full builder port

1. Add **routes** under `apps/web/app/` (e.g. `/workbench`, `/settings/genui`, or names that fit vita’s IA) instead of relying on Gui’s single-page shell.
2. Port **hooks** (e.g. `useCanvas` and related) and **components** (sidebar, tab bar, canvas, Corn jobs / ingest panels).
3. **Restyle** to vita’s **Tailwind** conventions where needed; keep **behavioral** logic as close as possible — expect **markup and tokens** to change.
4. Ensure **deep linking** and **auth gating** match vita’s existing **`/login`** and middleware behavior.

### Phase 5 — De-duplicate and sunset Gui GenUI

1. After parity: **freeze** new GenUI features in Gui or remove GenUI routes entirely.
2. Update **`Gui/README.md`** (or a short `DEPRECATED.md`) stating **vita-compare** owns GenUI.
3. Submodule: bump **`vita-compare`** pointer in Gui only if the parent repo must snapshot a reference commit; **development happens in vita-compare’s remote**.

---

## What still changes even with “same database”

- **Import paths** and **package boundaries** (monorepo layout).
- **Auth/tenant plumbing** at server boundaries (same RLS, different Next helpers).
- **Styling** (Gui design tokens vs Tailwind on vita).
- **Where cron runs** (hosting account and URL).
- Optional: **`framer-motion`** / other deps — add to **`apps/web/package.json`** if required by ported components.

---

## Risks / watchouts

| Risk | Mitigation |
|------|------------|
| **Dual writes to divergent code paths** | Time-box overlap; merge ports in vertical slices (API + minimal UI) and **switch traffic** per feature. |
| **Tenant_id drift** | Centralize “who is the current tenant” in vita’s pattern for every GenUI **insert**. |
| **Migration ordering** | Never apply Gui migration timestamps that **sort before** vita’s existing history when merging files into one repo — use **new** timestamps. |
| **RLS testing** | Smoke-test as **non-admin** and **second tenant** user in the **same** project after each phase. |

---

## Success criteria ( Measurable )

- [ ] Logged-in vita user can **complete the same core flows** as Gui: connect/observe ingest, open L2-backed source, **compose/refresh** canvas where applicable.
- [ ] **No production dependency** on Gui for those flows.
- [ ] **One** authoritative migration path under **`vita-compare/infra/supabase/migrations/`** for new GenUI schema changes.

---

## Open decision (grill-me) — next round

**Q1.** After GenUI is fully in vita-compare, where should **scheduled / worker** jobs (ingest drain, mail poll, etc.) run in **steady state**?

- **A.** **vita-compare only** — `packages/runtime` (or equivalent) + cron on the **vita** deployment (Railway/Vercel/other); single ops owner.
- **B.** **Temporary dual run** — keep Gui’s cron until vita parity, then **migrate and delete** Gui triggers on a dated cutover.
- **C.** **External orchestrator** — e.g. GitHub Actions or a generic scheduler HTTP-poking **`/api/...`** on vita; app stays stateless beyond route handlers.

**Recommended:** **A** — one repo, one place to read logs and rotate secrets; use **B** only as an explicit transitional window with a written cutover date.

---

*Once you answer **A / B / C** (or a blend), update this section with the decision and add **Q2** here for the next dependency (e.g. route naming under `/app` or shared package split).*
