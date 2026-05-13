import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGenuiL2Writer } from "@/lib/genui/l2-writer";

export type { GenuiL2Writer } from "@/lib/genui/l2-writer";

/** @deprecated Prefer `resolveGenuiL2Writer()` — returns JWT client only (not service_role path). */
export async function createSupabaseClientAsGenuiMachineUser(): Promise<SupabaseClient | null> {
  const w = await resolveGenuiL2Writer();
  if (w?.mode === "jwt") return w.client;
  return null;
}
