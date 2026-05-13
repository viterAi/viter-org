import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type GenuiL2Writer =
  | { mode: "jwt"; client: SupabaseClient }
  | { mode: "service_role"; client: SupabaseClient; attributedUserId: string };

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Client used for `genui_l2` inserts from trusted server code (mail poll, etc.).
 *
 * 1. If **`GENUI_L2_ATTRIBUTED_USER_ID`** is a valid UUID → **service role** client; each insert must
 *    include **`created_by: attributedUserId`** (that user must be in **`tenant_members`** for the row's `tenant_id`).
 * 2. Else → password sign-in as **`GENUI_L2_MACHINE_*`** or **`GENUI_WORKER_*`** (JWT); trigger sets `created_by`.
 */
export async function resolveGenuiL2Writer(): Promise<GenuiL2Writer | null> {
  const attributed = process.env.GENUI_L2_ATTRIBUTED_USER_ID?.trim() ?? "";
  if (attributed && uuidRe.test(attributed)) {
    return {
      mode: "service_role",
      client: getSupabaseAdminClient(),
      attributedUserId: attributed,
    };
  }

  const url = process.env.L0_SUPABASE_URL ?? process.env.NEXT_PUBLIC_L0_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_L0_SUPABASE_ANON_KEY ?? process.env.L0_SUPABASE_ANON_KEY;
  const email =
    process.env.GENUI_L2_MACHINE_EMAIL ?? process.env.GENUI_WORKER_EMAIL ?? "";
  const password =
    process.env.GENUI_L2_MACHINE_PASSWORD ?? process.env.GENUI_WORKER_PASSWORD ?? "";
  if (!url || !anon || !email || !password) {
    return null;
  }

  const base = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await base.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("[genui L2 writer] signInWithPassword failed:", error?.message ?? "no session");
    return null;
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { mode: "jwt", client };
}

/** JWT client for `genui_claim_next_job` and job row updates (requires tenant membership). */
export async function resolveGenuiWorkerJwtClient(): Promise<SupabaseClient | null> {
  const writer = await resolveGenuiL2Writer();
  if (writer?.mode === "jwt") return writer.client;

  const url = process.env.L0_SUPABASE_URL ?? process.env.NEXT_PUBLIC_L0_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_L0_SUPABASE_ANON_KEY ?? process.env.L0_SUPABASE_ANON_KEY;
  const email =
    process.env.GENUI_L2_MACHINE_EMAIL ?? process.env.GENUI_WORKER_EMAIL ?? "";
  const password =
    process.env.GENUI_L2_MACHINE_PASSWORD ?? process.env.GENUI_WORKER_PASSWORD ?? "";
  if (!url || !anon || !email || !password) return null;

  const base = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await base.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("[genui worker] signInWithPassword failed:", error?.message ?? "no session");
    return null;
  }

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}
