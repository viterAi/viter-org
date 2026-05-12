# T-024 — Corn jobs: simplified connect flow (Arcade Auth)

**Wave:** 6  
**Estimate:** 3–4 days  
**Depends on:** T-023 (`genui_channels`, `genui_ingest_jobs`, webhook pipeline)  
**Blocks:** End-user source connection without manual webhook setup

---

## Context

T-023 shipped the ingest pipeline but left the UI as a technical form requiring users to:
1. Manually paste `owner/repo`
2. Manually generate and paste a GitHub webhook signing secret
3. Write a free-text agent goal
4. Copy a webhook URL into GitHub settings themselves

Product goal: **any signed-in user can connect a GitHub repo, Gmail inbox, or Outlook mailbox in under 60 seconds without touching GitHub settings or writing a prompt.**

---

## Agreed design (from grill session — May 11 2026)

| Decision | Choice |
|----------|--------|
| GitHub connection | GitHub OAuth App via **Arcade Auth** — app auto-installs webhook |
| Email / Outlook | **Incoming ingest** via Arcade Auth + Trigger.dev polling every 5 min |
| OAuth UX | Multi-step **modal** on the Corn jobs page |
| OAuth popup | `window.open()` to Arcade auth URL; Arcade redirects to `/auth/arcade/done`; page `postMessage`s back |
| Agent goal | **Auto-generated** from repo/mailbox description via LLM; overridable via "Advanced" |
| Token storage | **Arcade manages all OAuth tokens** — no refresh tokens in our DB |
| Page layout | **Card grid** of connected services replaces technical form/list |
| DB | Add `last_polled_at` to `genui_channels`; use existing `source` field as channel type |

---

## Modal steps

```
Step 1 — pick:        [ GitHub ]  [ Gmail ]  [ Outlook ]
Step 2 — auth:        "Opening GitHub…" spinner + popup
Step 3 — pick-target: searchable dropdown of repos (GitHub) or mailboxes (Gmail/Outlook)
Step 4 — confirm:     Auto-generated goal, "Advanced" to edit, "Connect" button
Step 5 — done:        "Connected" ✓ card, modal closes
```

---

## Arcade Auth flow (per provider)

### GitHub

1. `POST /api/auth/arcade/start` — server calls `client.auth.authorize({provider_id: 'github', scopes: ['repo', 'admin:repo_hook'], user_id, next_uri: '/auth/arcade/done?auth_id=…'})`.
2. If `status === 'pending'` → return `{auth_url, auth_id}` to client; client opens popup.
3. After user authorizes → Arcade redirects to `/auth/arcade/done?auth_id=…`.
4. Done page: `window.opener.postMessage({type: 'arcade_auth_done', auth_id})` + `window.close()`.
5. Modal calls `GET /api/auth/arcade/repos?auth_id=…` → server calls `client.auth.status({id: auth_id})` → gets token → calls `GET https://api.github.com/user/repos`.
6. User picks repo.
7. `POST /api/genui/channels` with `{source: 'github', external_key, auth_id}` → server re-fetches token → calls `POST https://api.github.com/repos/{owner}/{repo}/hooks` with a freshly-generated `secret` → stores channel + secret in DB.

### Gmail / Outlook

1–4: Same as GitHub but `provider_id: 'google'` (Gmail) or `provider_id: 'microsoft'` (Outlook).
5. `GET /api/auth/arcade/mailboxes?auth_id=…&provider=gmail` → server uses token to list `INBOX` labels (Gmail) or mailbox folders (Outlook Graph).
6. User picks mailbox (or accepts "Primary inbox").
7. `POST /api/genui/channels` with `{source: 'gmail'|'outlook', external_key: email_address, auth_id}` → stores channel; Arcade retains the token for polling worker.

---

## Arcade verifier (optional for production)

Register `/api/auth/arcade/verify` in the Arcade Dashboard → Auth → Settings → Custom Verifier.

- Arcade sends `GET /api/auth/arcade/verify?flow_id=…&next_uri=…`
- Route reads `flow_id` + current user session → calls `client.auth.confirmUser({flow_id, user_id})`
- Redirects to `next_uri` (Arcade's completion URL).

_During development: use Arcade's built-in verifier (sign-in to Arcade.dev). Required for production multi-user._

---

## Webhook URL strategy

| Install method | Webhook URL | Tenant routing |
|----------------|-------------|----------------|
| Auto-install (this ticket) | `${NEXT_PUBLIC_APP_URL}/api/integrations/github/genui?t={tenantId}` | `?t=` query param |
| Arcade-forwarded (legacy) | Arcade project URL | `x-genui-tenant-id` header set by Arcade |

The webhook handler reads `x-genui-tenant-id` header first, falls back to `?t=` query param.

---

## Scope

**In scope**
- `ConnectServiceModal` component (pick → auth popup → target picker → confirm → done)
- `GenUIIngestJobsPanel` rewrite as card grid
- `CornJobsCanvas` header simplification
- `/api/auth/arcade/start`, `/api/auth/arcade/verify`, `/api/auth/arcade/repos`, `/api/auth/arcade/mailboxes`
- `/api/genui/channels` POST: handle `source: gmail|outlook`, auto-generate webhook secret for GitHub
- `/api/integrations/github/genui` route: accept `?t=` tenant query param
- `/auth/arcade/done` page (popup landing)
- Migration: `genui_channels.last_polled_at`

**Out of scope (follow-up)**
- Outlook push subscriptions / Gmail Pub/Sub (polling only in v1)
- Re-auth UX when Arcade token expires
- Per-channel goal editing post-connect (just remove + re-connect for now)
- Arcade custom verifier registration (manual step, documented)

---

## New env vars

```
ARCADE_API_KEY=              # from api.arcade.dev/dashboard/auth/settings
GENUI_ARCADE_WEBHOOK_URL=    # Arcade project forwarding URL (if using Arcade relay)
                             # omit to have GitHub webhook point directly to this app
```

---

## Deliverables

1. `ConnectServiceModal.tsx` — full multi-step modal
2. `GenUIIngestJobsPanel.tsx` — card grid rewrite
3. `/api/auth/arcade/*` routes (start, verify, repos, mailboxes)
4. `/auth/arcade/done/page.tsx` — popup landing
5. Updated `channels` POST + webhook route
6. Migration `…_genui_channels_last_polled.sql`
7. Updated `.env.example`
