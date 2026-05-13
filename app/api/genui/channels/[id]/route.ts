import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTenantIdForUser } from "@/lib/genui/resolve-tenant";
import { REPO_KEY, normalizeRepoKey } from "@/lib/genui/repo-key";

export const dynamic = "force-dynamic";

async function assertOwnsChannel(
  tenantId: string,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const admin = getSupabaseAdminClient();
  const { data: row } = await admin
    .from("genui_channels")
    .select("id, connected_by_user_id")
    .eq("id", channelId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return false;
  if ((row as { connected_by_user_id?: string }).connected_by_user_id === userId) return true;

  const { data: adminRow } = await admin
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (adminRow) return true;

  const { data: legacyAdmin } = await admin
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return Boolean(legacyAdmin);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: channelId } = await ctx.params;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenantId = await resolveTenantIdForUser(user.id);
  if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 });

  if (!(await assertOwnsChannel(tenantId, channelId, user.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: { external_key?: string; agent_prompt?: string; webhook_secret?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const repo = body.external_key != null ? normalizeRepoKey(body.external_key) : null;
  const prompt = body.agent_prompt != null ? String(body.agent_prompt).trim() : null;
  const secret = body.webhook_secret != null ? String(body.webhook_secret) : null;

  if (repo !== null && (!repo || !REPO_KEY.test(repo))) {
    return NextResponse.json({ error: "Invalid repository format." }, { status: 400 });
  }
  if (prompt !== null && prompt.length < 3) {
    return NextResponse.json({ error: "Agent goal too short." }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (repo !== null) {
    update.external_key = repo;
    update.display_name = repo;
  }
  if (prompt !== null) update.agent_prompt = prompt;

  if (Object.keys(update).length > 1) {
    const { error: upErr } = await admin.from("genui_channels").update(update).eq("id", channelId).eq("tenant_id", tenantId);
    if (upErr?.code === "23505") {
      return NextResponse.json({ error: "That repository name is already in use." }, { status: 409 });
    }
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (secret !== null && secret.length > 0) {
    const { error: secErr } = await admin.from("genui_channel_secrets").upsert(
      {
        genui_channel_id: channelId,
        github_webhook_secret: secret,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "genui_channel_id" },
    );
    if (secErr) return NextResponse.json({ error: secErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: channelId } = await ctx.params;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenantId = await resolveTenantIdForUser(user.id);
  if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 });

  if (!(await assertOwnsChannel(tenantId, channelId, user.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin.from("genui_channels").delete().eq("id", channelId).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
