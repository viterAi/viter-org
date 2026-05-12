import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingTableError(err: { code?: string; message?: string }): boolean {
  const m = err.message ?? "";
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    m.includes("Could not find the table") ||
    m.includes("does not exist")
  );
}

/**
 * Resolve tenant UUID for the signed-in user.
 *
 * 1. `tenant_memberships` (Gui bootstrap / legacy)
 * 2. `tenant_members` (vita RLS cutover)
 * 3. Slug → `tenants.id` when allowed (dev or `L0_ALLOW_TENANT_SLUG_FALLBACK=1`)
 * 4. `L0_DEV_TENANT_ID` when `NODE_ENV=development` or `L0_ALLOW_TENANT_SLUG_FALLBACK=1`
 */
export async function resolveTenantIdForUser(userId: string): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  const allowTenantFallbacks =
    process.env.NODE_ENV === "development" || process.env.L0_ALLOW_TENANT_SLUG_FALLBACK === "1";

  async function tenantFromMembershipTable(
    table: "tenant_memberships" | "tenant_members",
  ): Promise<string | null> {
    // `.maybeSingle()` errors if >1 row; `.limit(1)` keeps a deterministic pick when user belongs to several tenants.
    const { data, error } = await admin.from(table).select("tenant_id").eq("user_id", userId).limit(1).maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      console.warn(`[resolveTenantIdForUser] ${table}:`, error.message);
      return null;
    }
    return (data?.tenant_id as string | undefined) ?? null;
  }

  const fromLegacy = await tenantFromMembershipTable("tenant_memberships");
  if (fromLegacy) return fromLegacy;

  const fromVita = await tenantFromMembershipTable("tenant_members");
  if (fromVita) return fromVita;

  if (allowTenantFallbacks) {
    const slug =
      process.env.L0_DEFAULT_TENANT_SLUG ??
      process.env.GENUI_DEFAULT_TENANT_SLUG ??
      process.env.VITA_DEFAULT_TENANT_SLUG ??
      "viter";
    const { data: t, error } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (!error && t?.id) return t.id as string;
    if (error && !isMissingTableError(error)) {
      console.warn("[resolveTenantIdForUser] tenants slug lookup:", error.message);
    }
  }

  const devId = process.env.L0_DEV_TENANT_ID?.trim();
  if (allowTenantFallbacks && devId && UUID_RE.test(devId)) {
    return devId;
  }

  return null;
}
