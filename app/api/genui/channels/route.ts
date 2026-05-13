import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTenantIdForUser } from "@/lib/genui/resolve-tenant";
import { REPO_KEY, normalizeRepoKey } from "@/lib/genui/repo-key";
import { executeComposioTool } from "@/lib/composio/execute";
import { hasComposio } from "@/lib/composio/client";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const VALID_SOURCES = new Set(["github", "gmail", "outlook"]);

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // RLS on `genui_channels` limits rows to this user (or tenant admins — see migration).
  const { data: channels, error } = await supabase
    .from("genui_channels")
    .select("id, source, external_key, display_name, agent_prompt, created_at")
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

  // Store Composio connected account id (`ca_…`) for mail poll token lookup.
  const composioAccountId = String(body.auth_id ?? "").trim();
  if (!composioAccountId) {
    return NextResponse.json({ error: "Complete Composio mailbox authorization first." }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("genui_channels")
    .insert({
      tenant_id: tenantId,
      connected_by_user_id: user.id,
      source,
      external_key: email,
      display_name: email,
      agent_prompt: prompt,
      arcade_auth_user_id: composioAccountId,
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

  let webhookSecret = String(body.webhook_secret ?? "").trim();
  let autoInstalled = false;
  let installError: string | null = null;

  const wantsAuto = Boolean(body.auth_id && hasComposio());
  if (wantsAuto && webhookSecret.length < 8) {
    webhookSecret = randomBytes(20).toString("hex");
  }

  if (!wantsAuto && webhookSecret.length < 8) {
    return NextResponse.json(
      {
        error:
          "Provide a webhook signing secret (8+ characters) from GitHub repo → Settings → Webhooks, or complete Composio GitHub auth for auto-install.",
        code: "webhook_install_failed",
      },
      { status: 400 },
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from("genui_channels")
    .insert({
      tenant_id: tenantId,
      connected_by_user_id: user.id,
      source: "github",
      external_key: repo,
      display_name: repo,
      agent_prompt: prompt,
    })
    .select("id")
    .single();

  if (insErr?.code === "23505") {
    return NextResponse.json(
      { error: "That repo is already connected for your account. Remove it first." },
      { status: 409 },
    );
  }
  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  const channelId = inserted.id as string;

  const { error: secErr } = await admin.from("genui_channel_secrets").insert({
    genui_channel_id: channelId,
    github_webhook_secret: webhookSecret,
  });
  if (secErr) {
    await admin.from("genui_channels").delete().eq("id", channelId);
    return NextResponse.json({ error: secErr.message }, { status: 500 });
  }

  if (wantsAuto) {
    const installResult = await installGitHubWebhook({
      authId: body.auth_id!,
      repo,
      tenantId,
      userId: user.id,
      channelId,
      secret: webhookSecret,
    });
    if (installResult.ok) {
      autoInstalled = true;
    } else {
      installError = installResult.error;
      console.warn("[channels/POST] GitHub webhook auto-install failed:", installResult.error);
      await admin.from("genui_channel_secrets").delete().eq("genui_channel_id", channelId);
      await admin.from("genui_channels").delete().eq("id", channelId);
      return NextResponse.json(
        {
          error: `Could not install webhook automatically. ${installResult.error}`,
          code: "webhook_install_failed",
          install_error: installResult.error,
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    id: channelId,
    auto_installed: autoInstalled,
    webhook_url_hint: buildGenuiWebhookUrl(tenantId, channelId),
  });
}

function buildGenuiWebhookUrl(tenantId: string, channelId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const webhookBaseUrl = process.env.GENUI_ARCADE_WEBHOOK_URL ?? `${appUrl}/api/integrations/github/genui`;
  const sep = webhookBaseUrl.includes("?") ? "&" : "?";
  return `${webhookBaseUrl}${sep}t=${tenantId}&c=${channelId}`;
}

async function installGitHubWebhook({
  authId,
  repo,
  tenantId,
  userId,
  channelId,
  secret,
}: {
  authId: string;
  repo: string;
  tenantId: string;
  userId: string;
  channelId: string;
  secret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const slash = repo.indexOf("/");
    if (slash < 1) {
      return { ok: false, error: `Invalid repo "${repo}" — expected owner/name` };
    }
    const owner = repo.slice(0, slash);
    const repoName = repo.slice(slash + 1);

    const webhookUrl = buildGenuiWebhookUrl(tenantId, channelId);

    // GitHub won't accept hooks pointing at a private/loopback URL. Catch this
    // before the API call so the user sees a clear message instead of a
    // generic 422.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(webhookUrl)) {
      return {
        ok: false,
        error:
          "App URL is localhost. GitHub cannot deliver webhooks here — expose this server via a public URL (e.g. ngrok, Cloudflare Tunnel) and set NEXT_PUBLIC_APP_URL (or GENUI_ARCADE_WEBHOOK_URL) accordingly.",
      };
    }

    await executeComposioTool({
      slug: "GITHUB_CREATE_A_REPOSITORY_WEBHOOK",
      userId,
      connectedAccountId: authId,
      arguments: {
        owner,
        repo: repoName,
        active: true,
        events: ["push", "pull_request", "create", "delete", "release", "issues", "issue_comment"],
        config__url: webhookUrl,
        config__secret: secret,
        config__content__type: "json",
        config__insecure__ssl: "0",
      },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/saml|sso/i.test(message)) {
      return {
        ok: false,
        error: `GitHub blocked the request because the organisation requires SAML SSO authorization. Authorize the Composio GitHub app for your org in GitHub SSO settings, then retry.`,
      };
    }
    if (/404|not found/i.test(message)) {
      return {
        ok: false,
        error: `GitHub returned 404 for ${repo}. Usually means your account doesn't have admin permission on the repo (required to add a webhook) or the org hasn't approved this OAuth app. Ask an org admin to grant access, then retry.`,
      };
    }
    if (/403|forbidden/i.test(message)) {
      return {
        ok: false,
        error: `GitHub returned 403 for ${repo}. The OAuth token is missing 'admin:repo_hook' scope, or the org restricts hook creation. ${message}`,
      };
    }
    if (/422|already exists|unprocessable/i.test(message)) {
      return {
        ok: false,
        error: `GitHub rejected the webhook config: ${message}. Common causes: webhook URL is not publicly reachable, or a webhook with this URL already exists on the repo.`,
      };
    }
    return { ok: false, error: message };
  }
}
