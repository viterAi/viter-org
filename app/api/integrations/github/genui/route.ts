/**
 * POST /api/integrations/github/genui — same contract as vita-compare ingest route.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseGitHubRepositoryFullName, verifyGitHubSignature256 } from "@/lib/genui/github-webhook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // When GENUI_ARCADE_FORWARD_SECRET is set, verify the Arcade relay hop.
  // Auto-installed webhooks point directly to this app (no relay), so the header is absent.
  const forwardSecret = process.env.GENUI_ARCADE_FORWARD_SECRET;
  if (forwardSecret) {
    const gotForward = req.headers.get("x-genui-forward-secret");
    if (gotForward !== forwardSecret) {
      return NextResponse.json({ error: "unauthorized forward" }, { status: 401 });
    }
  }

  // Tenant ID from Arcade-forwarded header (legacy) or ?t= query param (auto-installed webhooks)
  const { searchParams } = new URL(req.url);
  const tenantHeader = req.headers.get("x-genui-tenant-id") ?? searchParams.get("t") ?? "";
  if (!tenantHeader || !isUuid(tenantHeader)) {
    return NextResponse.json({ error: "missing or invalid tenant id (x-genui-tenant-id header or ?t= param)" }, { status: 400 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");

  const deliveryId = req.headers.get("x-github-delivery");
  const repoFullNameRaw = parseGitHubRepositoryFullName(rawBody);
  if (!repoFullNameRaw) {
    return NextResponse.json({ error: "could not parse repository.full_name from payload" }, { status: 400 });
  }
  const repoFullName = repoFullNameRaw.toLowerCase();

  const db = getSupabaseAdminClient();

  const channelIdParam = searchParams.get("c") ?? "";
  let channelId: string | undefined;

  if (channelIdParam && isUuid(channelIdParam)) {
    const { data: row, error: oneErr } = await db
      .from("genui_channels")
      .select("id")
      .eq("id", channelIdParam)
      .eq("tenant_id", tenantHeader)
      .eq("source", "github")
      .eq("external_key", repoFullName)
      .maybeSingle();
    if (oneErr) {
      return NextResponse.json({ error: oneErr.message }, { status: 500 });
    }
    channelId = row?.id as string | undefined;
  } else {
    const { data: candidates, error: chErr } = await db
      .from("genui_channels")
      .select("id")
      .eq("tenant_id", tenantHeader)
      .eq("source", "github")
      .eq("external_key", repoFullName);

    if (chErr) {
      return NextResponse.json({ error: chErr.message }, { status: 500 });
    }
    const ids = (candidates ?? []).map((r) => r.id as string);
    for (const id of ids) {
      const { data: secRow } = await db
        .from("genui_channel_secrets")
        .select("github_webhook_secret")
        .eq("genui_channel_id", id)
        .maybeSingle();
      const secret = (secRow?.github_webhook_secret as string | undefined) ?? "";
      if (secret && verifyGitHubSignature256(rawBody, sig, secret)) {
        channelId = id;
        break;
      }
    }
    if (!channelId && ids.length === 1) {
      const { data: secRow } = await db
        .from("genui_channel_secrets")
        .select("github_webhook_secret")
        .eq("genui_channel_id", ids[0])
        .maybeSingle();
      const fallback = (secRow?.github_webhook_secret as string | undefined) ?? process.env.GITHUB_WEBHOOK_SECRET ?? "";
      if (fallback && verifyGitHubSignature256(rawBody, sig, fallback)) {
        channelId = ids[0];
      }
    }
  }

  if (!channelId) {
    return NextResponse.json(
      {
        error: "unknown_repo",
        hint:
          "Add this repository under Corn jobs (per-user URL includes ?c=<channelId>) or update the GitHub webhook URL after reconnecting.",
      },
      { status: 404 },
    );
  }

  const { data: secRow } = await db
    .from("genui_channel_secrets")
    .select("github_webhook_secret")
    .eq("genui_channel_id", channelId)
    .maybeSingle();

  const githubSecret =
    (secRow?.github_webhook_secret as string | undefined) ?? process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!githubSecret) {
    return NextResponse.json(
      { error: "no_signing_secret", hint: "Save the webhook signing secret in Corn jobs for this repo." },
      { status: 500 },
    );
  }

  if (!verifyGitHubSignature256(rawBody, sig, githubSecret)) {
    return NextResponse.json({ error: "invalid GitHub signature" }, { status: 401 });
  }

  const idempotencyKey =
    deliveryId && channelId ? `${channelId}:${deliveryId}` : deliveryId ?? null;

  const insertPayload = {
    tenant_id: tenantHeader,
    genui_channel_id: channelId,
    status: "pending" as const,
    ingest_kind: "webhook" as const,
    idempotency_key: idempotencyKey,
    raw_body: rawBody,
    updated_at: new Date().toISOString(),
  };

  const { data: job, error: jobErr } = await db.from("genui_ingest_jobs").insert(insertPayload).select("id").single();

  if (jobErr) {
    if (isUniqueViolation(jobErr) && deliveryId) {
      return NextResponse.json({ ok: true, duplicate: true, idempotency_key: deliveryId }, { status: 200 });
    }
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, job_id: job?.id, genui_channel_id: channelId }, { status: 202 });
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isUniqueViolation(err: { code?: string }): boolean {
  return err.code === "23505";
}
