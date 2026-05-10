# Auth Wiring Plan — Next.js ↔ Supabase

**Written:** May 10, 2026  
**Updated:** May 10, 2026  
**Status:** Steps 1–6 complete — all API routes guarded; step 7 (auth context in views) not yet started  
**Depends on:** `docs/auth-and-data-access.md` (DB schema reference)

---

## Implementation Progress

| Step | Task | Status |
|---|---|---|
| 1 | Install `@supabase/ssr`, rewrite 3 client files | ✅ Done |
| 2 | Add `middleware.ts` | ✅ Done |
| 3 | Create `app/login/page.tsx` | ✅ Done (password auth, not magic link) |
| 4 | Add `UserProvider` + `UserContext` | ✅ Done |
| 5 | Update `bootstrap` route | ✅ Done |
| 6 | Auth-guard all API routes | ⚠️ Partial — `views` and `apply` guarded; `sources`, `canvas`, `canvas/refresh`, `steer` still unguarded |
| 7 | Pass auth context to generated views | ❌ Not started |

**Remaining work:**
- Pass `{ userId, tenantId }` from `useUser()` into `CanvasContent` (step 7)
- Replace `getMockMessages()` / `getMockChats()` with real DB queries (currently backed by mock data)

**Note on Supabase project consolidation:** All three clients (browser, server, admin) now point to the L0 project (`dkccadwohifcqcdzhhnu`). Auth, tenants, and views all live there. The original UI project (`vwqalkghhdgjumjdgtpd`) credentials remain in `.env` but appear unused in active code — confirm with Mordechai before removing.

---

## Original State (at time of writing)

| Layer | Status |
|---|---|
| DB schema | Ready — `tenants`, `tenant_memberships`, `tenant_members` all exist |
| RLS policies | Written and enabled on every table (`views`, `view_versions`, `view_drafts` included) |
| Helper functions | `current_tenant_id()`, `is_tenant_member()`, `user_can_read_channel()` all deployed |
| Auth users | 1 user (`mordechaipotash@gmail.com`), 1 tenant (`viter`), role: `owner` |
| App auth | **None** — both Supabase clients use `persistSession: false`, no session cookie is ever sent |
| Result | `auth.uid()` returns `null` on every DB call → RLS blocks all access silently |

The DB is done. The app needs to be wired.

---

## What Needs to Change

### 1. Supabase client strategy

The current `lib/supabase/server.ts` and `lib/supabase/admin.ts` create plain clients that ignore cookies. Replace these with the `@supabase/ssr` pattern which has three distinct clients:

| Client | Used in | How session is read |
|---|---|---|
| Browser client | Client components | Reads/writes cookies from `document.cookie` |
| Server client | Route Handlers, Server Components | Reads cookies from the incoming `Request` |
| Middleware client | `middleware.ts` | Reads and refreshes cookies between requests |

### 2. Route protection

Every page except `/login` must require an active session. This is handled by a single `middleware.ts` file — not per-route checks.

### 3. Login page

A new `app/login/page.tsx` with email + magic link (no passwords). Right for an internal tool — you control who gets invited through the Supabase dashboard. No public signup.

### 4. App reads the tenant from the session

Once logged in, the user's `tenant_id` is resolved via `current_tenant_id()` which is already in the DB. The app needs to pass this down to API routes and generated views.

---

## Implementation Steps

### Step 1 — Install `@supabase/ssr`

```bash
npm install @supabase/ssr
```

No other new dependencies needed.

---

### Step 2 — Rewrite the three client files

**`lib/supabase/browser.ts`** — replaces nothing, new file for client components:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

**`lib/supabase/server.ts`** — rewrite to read cookies from the request:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}
```

**`lib/supabase/admin.ts`** — vita DB (L0 data). Keep this as a **service role** client, never exposed to the browser. Used only server-side for vita queries, scoped by `tenant_id` from the authenticated user:

```ts
import { createClient } from "@supabase/supabase-js";

export function getVitaServiceClient() {
  return createClient(
    process.env.L0_SUPABASE_URL!,
    process.env.L0_SUPABASE_SERVICE_KEY!, // service key, never NEXT_PUBLIC_
    { auth: { persistSession: false } },
  );
}
```

> Note: `L0_SUPABASE_SERVICE_KEY` needs to be added to `.env`. The service role key is in the Supabase dashboard under Project Settings → API.

---

### Step 3 — Add `middleware.ts`

Create at the repo root (same level as `app/`):

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/bootstrap).*)"],
};
```

---

### Step 4 — Create `app/login/page.tsx`

Magic link flow. User enters email → Supabase sends a link → they click it → session cookie is set → middleware redirects to `/`.

```tsx
"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div style={{ ... }}>
      {sent ? (
        <p>Check your email for a login link.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
          <button type="submit">Send login link</button>
          {error && <p>{error}</p>}
        </form>
      )}
    </div>
  );
}
```

Style this to match the platform's design tokens (use CSS vars from `globals.css`).

---

### Step 5 — Add `UserProvider` to layout

Create `lib/auth/UserContext.tsx` — a thin context that holds `user` and `tenantId` so any component can access them without prop-drilling:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { User } from "@supabase/supabase-js";

type UserContextValue = {
  user: User | null;
  tenantId: string | null;
};

const UserContext = createContext<UserContextValue>({ user: null, tenantId: null });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });
    // tenantId is fetched once and cached; it comes from the bootstrap API route
    fetch("/api/bootstrap")
      .then((r) => r.json())
      .then((d) => setTenantId(d.tenantId ?? null));
  }, []);

  return (
    <UserContext.Provider value={{ user, tenantId }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
```

Wrap it in `app/layout.tsx`:

```tsx
import { UserProvider } from "@/lib/auth/UserContext";

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <TokenProvider>
          <UserProvider>{children}</UserProvider>
        </TokenProvider>
      </body>
    </html>
  );
}
```

---

### Step 6 — Update the bootstrap API route

`app/api/bootstrap/route.ts` already exists. Add a session check and return `tenantId`:

```ts
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { data } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return Response.json({ userId: user.id, tenantId: data?.tenant_id ?? null });
}
```

---

### Step 7 — Update all API routes to check auth

Every route handler that touches the DB needs the same pattern at the top:

```ts
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
```

Because the server client sends the session cookie, `auth.uid()` is set for every subsequent DB call and all RLS policies enforce automatically. No further changes needed to the queries themselves.

Routes to update:
- `app/api/sources/route.ts`
- `app/api/sources/[sourceId]/views/route.ts`
- `app/api/sources/[sourceId]/canvas/route.ts`
- `app/api/sources/[sourceId]/canvas/refresh/route.ts`
- `app/api/sources/[sourceId]/steer/route.ts`
- `app/api/views/[viewId]/apply/route.ts`
- `app/api/views/[viewId]/actions/route.ts`

---

### Step 8 — Pass auth context to generated views

The checklist item: *"Auth context passed to generated views (who's viewing, permissions)"*

Once `useUser()` is available in the app, pass `{ userId, tenantId }` into `CanvasContent` and include it in the spec render context. This allows generated views to know who is viewing them (for action attribution, permission-gated UI, etc.).

---

## What Does NOT Need to Change

- No DB schema changes — tenant model is fully built
- No RLS policy changes — views, view_versions, view_drafts all have correct policies
- No vita DB schema changes — vita queries stay server-side, scoped by `tenant_id` from the authenticated session
- No changes to the view spec format or rendering pipeline

---

## Rollout Order

| # | Task | Estimated effort |
|---|---|---|
| 1 | Install `@supabase/ssr`, rewrite 3 client files | 15 min |
| 2 | Add `middleware.ts` | 10 min |
| 3 | Create `app/login/page.tsx` | 20 min |
| 4 | Add `UserProvider` + `UserContext` | 20 min |
| 5 | Update `bootstrap` route | 10 min |
| 6 | Update all API routes (auth guard) | 30 min |
| 7 | Pass auth context to views | 15 min |
| **Total** | | **~2 hours** |

---

## Current Users & Tenants (as of May 10, 2026)

| User | Tenant | Role |
|---|---|---|
| mordechaipotash@gmail.com | viter | owner |

Adding a new user = invite them via Supabase Auth dashboard (send magic link), then add a row to `tenant_memberships` with their `user_id` and the `viter` tenant ID.
