import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client using a password-auth user (genUI machine account).
 * Required for `genui_l2` inserts under RLS + `genui_l2_enforce_created_by` trigger
 * (service_role has no `auth.uid()` and must not write this table).
 */
export async function createSupabaseClientAsGenuiMachineUser(): Promise<SupabaseClient | null> {
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
    console.error("[genui machine] signInWithPassword failed:", error?.message ?? "no session");
    return null;
  }

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}
