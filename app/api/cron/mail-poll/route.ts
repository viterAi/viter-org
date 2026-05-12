/**
 * GET /api/cron/mail-poll
 *
 * Runs every 5 minutes (see vercel.json).
 * For every Gmail / Outlook channel that has an arcade_auth_user_id stored,
 * fetches new messages since last_polled_at, summarises each one via LLM,
 * and upserts the result into genui_l2.
 *
 * Protected by CRON_SECRET — Vercel Cron sets the Authorization header
 * automatically; local callers must set it manually.
 */

import { NextResponse } from "next/server";
import { Arcade } from "@arcadeai/arcadejs";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Pro max for cron

// ─── types ──────────────────────────────────────────────────────────────────

type Channel = {
  id: string;
  tenant_id: string;
  source: "gmail" | "outlook" | string;
  external_key: string;
  agent_prompt: string;
  arcade_auth_user_id: string;
  last_polled_at: string | null;
};

type GmailMessage = {
  id: string;
  threadId: string;
  payload?: {
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { mimeType: string; body?: { data?: string } }[];
  };
  snippet?: string;
  internalDate?: string;
};

type OutlookMessage = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
  receivedDateTime?: string;
  body?: { content?: string; contentType?: string };
};

// ─── handler ────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Verify Vercel cron secret
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const arcade = new Arcade({ apiKey: process.env.ARCADE_API_KEY! });
  const db = getSupabaseAdminClient();

  const { data: channels, error: chErr } = await db
    .from("genui_channels")
    .select("id, tenant_id, source, external_key, agent_prompt, arcade_auth_user_id, last_polled_at")
    .in("source", ["gmail", "outlook"])
    .not("arcade_auth_user_id", "is", null);

  if (chErr) {
    console.error("[mail-poll] Failed to load channels:", chErr.message);
    return NextResponse.json({ error: chErr.message }, { status: 500 });
  }

  const results: { channel_id: string; inserted: number; skipped: number; error?: string }[] = [];

  for (const ch of (channels ?? []) as Channel[]) {
    try {
      const r = await processChannel(ch, arcade, db);
      results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mail-poll] channel ${ch.id} error:`, msg);
      results.push({ channel_id: ch.id, inserted: 0, skipped: 0, error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}

// ─── per-channel logic ───────────────────────────────────────────────────────

async function processChannel(
  ch: Channel,
  arcade: Arcade,
  db: ReturnType<typeof getSupabaseAdminClient>,
): Promise<{ channel_id: string; inserted: number; skipped: number; error?: string }> {
  const provider = ch.source === "gmail" ? "google" : "microsoft";
  const scopes =
    ch.source === "gmail"
      ? ["https://www.googleapis.com/auth/gmail.readonly"]
      : ["https://graph.microsoft.com/Mail.Read", "offline_access"];

  // Get (or refresh) the OAuth token from Arcade
  const authRes = await arcade.auth.start(ch.arcade_auth_user_id, provider, { scopes });
  if (authRes.status !== "completed" || !authRes.context?.token) {
    console.warn(`[mail-poll] ${ch.id}: token not ready (status=${authRes.status}) — skipping`);
    return { channel_id: ch.id, inserted: 0, skipped: 0, error: "token_not_ready" };
  }
  const token = authRes.context.token as string;

  const since = ch.last_polled_at ? new Date(ch.last_polled_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const messages =
    ch.source === "gmail"
      ? await fetchGmailMessages(token, since)
      : await fetchOutlookMessages(token, since);

  let inserted = 0;
  let skipped = 0;

  for (const msg of messages) {
    const payload = await summariseMessage(msg, ch.agent_prompt, ch.source);
    if (!payload) { skipped++; continue; }

    const externalId = msg.id;
    const { error: insErr } = await db.from("genui_l2").insert({
      tenant_id: ch.tenant_id,
      genui_channel_id: ch.id,
      external_event_id: externalId,
      ingest_kind: ch.source === "gmail" ? "gmail_poll" : "outlook_poll",
      generator: "openrouter_ai",
      payload,
      updated_at: new Date().toISOString(),
    });

    if (insErr?.code === "23505") {
      // Already ingested this message — skip silently
      skipped++;
    } else if (insErr) {
      console.error(`[mail-poll] insert error for msg ${externalId}:`, insErr.message);
      skipped++;
    } else {
      inserted++;
    }
  }

  // Stamp last_polled_at regardless of results so we advance the window
  await db
    .from("genui_channels")
    .update({ last_polled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", ch.id);

  console.log(`[mail-poll] ${ch.id} (${ch.source}): inserted=${inserted} skipped=${skipped}`);
  return { channel_id: ch.id, inserted, skipped };
}

// ─── Gmail ───────────────────────────────────────────────────────────────────

async function fetchGmailMessages(token: string, since: Date): Promise<{ id: string; subject: string; from: string; snippet: string; body: string; date: string }[]> {
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const query = `after:${afterEpoch} in:inbox`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) {
    const t = await listRes.text();
    throw new Error(`Gmail list error ${listRes.status}: ${t}`);
  }
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);

  const results: { id: string; subject: string; from: string; snippet: string; body: string; date: string }[] = [];

  await Promise.all(
    ids.map(async (id) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!msgRes.ok) return;
      const msg = (await msgRes.json()) as GmailMessage;

      const headers = msg.payload?.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "unknown";
      const date = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();

      const body = extractGmailBody(msg) ?? msg.snippet ?? "";
      results.push({ id, subject, from, snippet: msg.snippet ?? "", body, date });
    }),
  );

  return results;
}

function extractGmailBody(msg: GmailMessage): string | null {
  // Prefer plain text part
  const parts = msg.payload?.parts ?? [];
  const textPart = parts.find((p) => p.mimeType === "text/plain") ?? parts.find((p) => p.mimeType === "text/html");
  const encoded = textPart?.body?.data ?? msg.payload?.body?.data;
  if (!encoded) return null;
  return Buffer.from(encoded, "base64url").toString("utf-8").slice(0, 4000);
}

// ─── Outlook ─────────────────────────────────────────────────────────────────

async function fetchOutlookMessages(token: string, since: Date): Promise<{ id: string; subject: string; from: string; snippet: string; body: string; date: string }[]> {
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=id,subject,from,bodyPreview,receivedDateTime,body&$top=20&$orderby=receivedDateTime desc`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Outlook list error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { value?: OutlookMessage[] };

  return (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "(no subject)",
    from: `${m.from?.emailAddress?.name ?? ""} <${m.from?.emailAddress?.address ?? ""}>`.trim(),
    snippet: m.bodyPreview ?? "",
    body: (m.body?.content ?? m.bodyPreview ?? "").slice(0, 4000),
    date: m.receivedDateTime ?? new Date().toISOString(),
  }));
}

// ─── LLM summarisation ────────────────────────────────────────────────────────

async function summariseMessage(
  msg: { id: string; subject: string; from: string; snippet: string; body: string; date: string },
  agentPrompt: string,
  source: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return buildFallbackPayload(msg, source);

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";

  const prompt = `You are an assistant that extracts structured data from emails.

Agent goal: "${agentPrompt}"

Email details:
- From: ${msg.from}
- Date: ${msg.date}
- Subject: ${msg.subject}
- Body: ${msg.body.slice(0, 2000)}

Return a JSON object (no markdown) with these fields:
- subject (string)
- from (string)
- date (ISO string)
- summary (1-2 sentence plain-English summary relevant to the agent goal)
- action_required (boolean — true if this email needs a response or action)
- priority ("high" | "medium" | "low")
- tags (string[] — relevant labels, max 5)
- raw_snippet (string — first 200 chars of body)`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a strict JSON generator. Output valid JSON only, no markdown fences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) return buildFallbackPayload(msg, source);

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return { ...parsed, message_id: msg.id, source, ingest_kind: source === "gmail" ? "gmail_poll" : "outlook_poll" };
  } catch {
    return buildFallbackPayload(msg, source);
  }
}

function buildFallbackPayload(
  msg: { id: string; subject: string; from: string; snippet: string; date: string },
  source: string,
): Record<string, unknown> {
  return {
    message_id: msg.id,
    subject: msg.subject,
    from: msg.from,
    date: msg.date,
    summary: msg.snippet,
    action_required: false,
    priority: "medium",
    tags: [],
    raw_snippet: msg.snippet.slice(0, 200),
    source,
    ingest_kind: source === "gmail" ? "gmail_poll" : "outlook_poll",
  };
}
