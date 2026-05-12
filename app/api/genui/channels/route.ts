import { NextResponse } from "next/server";
import { Arcade } from "@arcadeai/arcadejs";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTenantIdForUser } from "@/lib/genui/resolve-tenant";
import { REPO_KEY, normalizeRepoKey } from "@/lib/genui/repo-key";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const VALID_SOURCES = new Set(["github", "gmail", "outlook"]);

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenantId = await resolveTenantIdForUser(user.id);
  if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 });

  const admin = getSupabaseAdminClient();
  const { data: channels, error } = await admin
    .from("genui_channels")
    .select("id, source, external_key, display_name, agent_prompt, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channels: channels ?? [] });
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenantId = await resolveTenantIdForUser(user.id);
  if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 });

  let body: {
    source?: string;
    external_key?: string;
    agent_prompt?: string;
    // Legacy fields (manual GitHub form — kept for backward compat)
    webhook_secret?: string;
    // New connect-flow fields
    auth_id?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const source = String(body.source ?? "github").toLowerCase();
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json({ error: `source must be one of: ${[...VALID_SOURCES].join(", ")}` }, { status: 400 });
  }

  const prompt = String(body.agent_prompt ?? "").trim();
  if (prompt.length < 3) {
    return NextResponse.json(
      { error: "Describe the agent goal for this connection (a few words minimum)." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdminClient();

  if (source === "github") {
    return handleGitHub({ body, tenantId, prompt, admin, user });
  }

  // Gmail / Outlook — store the channel; polling worker handles the rest
  const email = String(body.external_key ?? "").trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "external_key must be the mailbox email address." }, { status: 400 });
  }

  // Store the Arcade user_id (Supabase user email) so the cron worker can look up the token
  const arcadeAuthUserId = user.email ?? user.id;

  const { data: inserted, error: insErr } = await admin
    .from("genui_channels")
    .insert({
      tenant_id: tenantId,
      source,
      external_key: email,
      display_name: email,
      agent_prompt: prompt,
      arcade_auth_user_id: arcadeAuthUserId,
    })
    .select("id")
    .single();

  if (insErr?.code === "23505") {
    return NextResponse.json({ error: "That mailbox is already connected." }, { status: 409 });
  }
  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}

async function handleGitHub({
  body,
  tenantId,
  prompt,
  admin,
  user,
}: {
  body: {
    source?: string;
    external_key?: string;
    agent_prompt?: string;
    webhook_secret?: string;
    auth_id?: string;
  };
  tenantId: string;
  prompt: string;
  admin: ReturnType<typeof getSupabaseAdminClient>;
  user: { id: string };
}): Promise<NextResponse> {
  const repo = normalizeRepoKey(body.external_key ?? "");
  if (!repo || !REPO_KEY.test(repo)) {
    return NextResponse.json({ error: "Repository must look like owner/repo." }, { status: 400 });
  }

  let webhookSecret = String(body.webhook_secret ?? "");
  let autoInstalled = false;

  // Try auto-install via Arcade Auth token
  if (body.auth_id && process.env.ARCADE_API_KEY) {
    const installResult = await installGitHubWebhook({ authId: body.auth_id, repo, tenantId, userId: user.id });
    if (installResult.ok) {
      webhookSecret = installResult.secret;
      autoInstalled = true;
    } else {
      // Log but don't fail — fall through to manual secret requirement
      console.warn("[channels/POST] GitHub webhook auto-install failed:", installResult.error);
    }
  }

  if (!autoInstalled && webhookSecret.length < 8) {
    return NextResponse.json(
      { error: "Webhook signing secret is required (from GitHub webhook settings), or provide auth_id for auto-install." },
      { status: 400 },
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from("genui_channels")
    .insert({
      tenant_id: tenantId,
      source: "github",
      external_key: repo,
      display_name: repo,
      agent_prompt: prompt,
    })
    .select("id")
    .single();

  if (insErr?.code === "23505") {
    return NextResponse.json({ error: "That repo is already connected. Remove it first." }, { status: 409 });
  }
  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  const { error: secErr } = await admin.from("genui_channel_secrets").insert({
    genui_channel_id: inserted.id as string,
    github_webhook_secret: webhookSecret,
  });
  if (secErr) {
    await admin.from("genui_channels").delete().eq("id", inserted.id);
    return NextResponse.json({ error: secErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: inserted.id, auto_installed: autoInstalled });
}

async function installGitHubWebhook({
  authId,
  repo,
  tenantId,
  userId,
}: {
  authId: string;
  repo: string;
  tenantId: string;
  userId: string;
}): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  try {
    const client = new Arcade({ apiKey: process.env.ARCADE_API_KEY! });
    const authStatus = await client.auth.status({ id: authId });

    if (authStatus.status !== "completed" || !authStatus.context?.token) {
      return { ok: false, error: "Arcade auth not completed" };
    }

    void userId; // reserved for future per-user token lookup

    const token = authStatus.context.token;
    const secret = randomBytes(20).toString("hex");
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const webhookBaseUrl = process.env.GENUI_ARCADE_WEBHOOK_URL ?? `${appUrl}/api/integrations/github/genui`;
    const webhookUrl = webhookBaseUrl.includes("?")
      ? `${webhookBaseUrl}&t=${tenantId}`
      : `${webhookBaseUrl}?t=${tenantId}`;

    const ghRes = await fetch(`https://api.github.com/repos/${repo}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push", "pull_request", "create", "delete", "release", "issues", "issue_comment"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
      }),
    });

    if (!ghRes.ok) {
      const text = await ghRes.text();
      return { ok: false, error: `GitHub API ${ghRes.status}: ${text}` };
    }

    return { ok: true, secret };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
