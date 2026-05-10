# UI Comparison Issues — Gui vs vita-compare

> Generated 2026-05-06. Four actionable Issues derived from the UI comparison between this project and vita-compare.

---

## Issue 1 — Add dark mode

**Labels:** `feature` `size:M`
**Assignee:** _unassigned_

### What
Add dark mode support to the Gui app using CSS variables and `prefers-color-scheme`.

### Why
vita-compare ships full dark mode out of the box. Gui has a warm light palette but no dark variant, making it harder to use in low-light environments and putting it behind on a table-stakes UX expectation.

### Acceptance criteria
- [ ] All CSS variable tokens in `globals.css` have a `@media (prefers-color-scheme: dark)` override
- [ ] Page background, surface, ink, line, and semantic (accent/warn/danger/good) tokens all adapt
- [ ] No hardcoded colors remain in `app/page.tsx` inline styles
- [ ] Visually tested on macOS dark mode

### Notes
Current tokens: `--bg-page: #f4f2ee`, `--bg-surface: #fff`, `--ink-primary: #1a1a1a` etc. in `app/globals.css`. The warm palette maps naturally to dark: bg-page → ~#1c1a17, surface → #242220.

### Scope
_To be filled in before work starts._

---

## Issue 2 — Break up `app/page.tsx` into components

**Labels:** `chore` `size:M`
**Status:** ✅ Resolved (T-002 complete)

### Resolution
`app/page.tsx` is now 141 lines and only orchestrates layout. Components extracted to `app/components/`:
- `LeftSidebar` — source list
- `Murmur` — top bar
- `TabBar` — view tabs
- `CanvasContent` — main canvas
- `Dock` — steer panel
- `AiComponentRenderer` — all component rendering cases
- `LegacyViewRenderer`, `GenerationProgress`, `AiStatusPanel`, `AnimatedTile`, `SourceIcon`

Hooks extracted to `app/hooks/`: `useCanvas`, `useSources`, `useResizablePanels`.

---

## Issue 3 — Real-time view updates via Supabase subscriptions

**Labels:** `feature` `size:L`
**Assignee:** _unassigned_

### What
Add real-time view updates using Supabase `postgres_changes` subscriptions so the main panel refreshes when underlying data changes without a manual reload.

### Why
vita-compare has a `RealtimeStream` component that subscribes to Supabase and appends new rows live, including a "↓ N new" pill when the user has scrolled up. Gui requires a full page reload to see new data — a significant UX gap for a live business dashboard.

### Acceptance criteria
- [ ] A `useRealtimeView` hook subscribes to the active view's underlying table via `postgres_changes`
- [ ] The main panel re-fetches and re-renders when a relevant insert/update arrives
- [ ] A "New data — refresh" banner or auto-refresh handles the update gracefully
- [ ] Subscription is torn down when the view changes or the component unmounts
- [ ] Tested with a live Supabase insert

### Notes
Supabase client is already set up (`@supabase/supabase-js` in `package.json`). vita-compare uses `@supabase/ssr`; check if that's needed or if the existing client suffices. See `vita-compare/apps/web/app/chat/RealtimeStream.tsx` for reference implementation.

### Scope
_To be filled in before work starts._

---

## Issue 4 — Multi-route navigation (login, source detail, view deep-links)

**Labels:** `feature` `size:L`
**Assignee:** _unassigned_

### What
Add multi-route navigation so Settings, a Login/auth flow, and source-level detail views each have their own URL.

### Why
Gui currently has one route (`/`) and renders all state conditionally in a single page. vita-compare has clean routes (`/login`, `/chat/[slug]`, `/settings/whatsapp`, `/spaces/[slug]/inbox`). Single-page-everything makes deep-linking, browser history, and auth-gating impossible and constrains future growth.

### Acceptance criteria
- [ ] `/login` route with email OTP (matches existing Supabase auth setup)
- [ ] `/sources/[sourceId]` replaces in-page source selection — URL changes on source switch
- [ ] `/sources/[sourceId]/views/[viewId]` deep-links to a specific view tab
- [ ] Auth middleware redirects unauthenticated users to `/login`
- [ ] Browser back/forward works correctly across all new routes

### Notes
Existing API routes live under `app/api/**`. New page routes go alongside them in `app/`. No new router library needed — Next.js App Router handles this natively. Auth guard via `middleware.ts`. This is `size:L`; consider splitting login vs. source routing into two sub-issues.

### Scope
_To be filled in before work starts._
