import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureKindGrouping } from "@/lib/genui/kind-grouping";

export type MailPollChannelResult = {
  channel_id: string;
  inserted: number;
  skipped: number;
  error?: string;
};

export type MailPollRunResult = {
  ok: boolean;
  results: MailPollChannelResult[];
  error?: string;
};

type Channel = {
  id: string;
  tenant_id: string;
  source: "gmail" | "outlook" | string;
  external_key: string;
  agent_prompt: string;
  arcade_auth_user_id: string;
  connected_by_user_id: string;
  last_polled_at: string | null;
};

type OutlookMessage = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
  receivedDateTime?: string;
  body?: { content?: string; contentType?: string };
};

/**
 * Poll Gmail/Outlook-backed `genui_channels`, summarise new messages, insert `genui_l2`.
 * Used by the HTTP route and by `instrumentation.ts` when `MAIL_POLL_INTERVAL_MS` is set.
 */
export async function runMailPoll(): Promise<MailPollRunResult> {
  const { hasComposio } = await import("@/lib/composio/client");
  if (!hasComposio()) {
    return { ok: false, results: [], error: "missing COMPOSIO_API_KEY" };
  }

  const db = getSupabaseAdminClient();

  const { data: channels, error: chErr } = await db
    .from("genui_channels")
    .select("id, tenant_id, source, external_key, agent_prompt, arcade_auth_user_id, connected_by_user_id, last_polled_at")
    .in("source", ["gmail", "outlook"])
    .not("arcade_auth_user_id", "is", null);

  if (chErr) {
    console.error("[mail-poll] Failed to load channels:", chErr.message);
    return { ok: false, results: [], error: chErr.message };
  }

  const results: MailPollChannelResult[] = [];

  for (const ch of (channels ?? []) as Channel[]) {
    try {
      const r = await processChannel(ch, db);
      results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mail-poll] channel ${ch.id} error:`, msg);
      results.push({ channel_id: ch.id, inserted: 0, skipped: 0, error: msg });
    }
  }

  return { ok: true, results };
}

async function processChannel(
  ch: Channel,
  db: ReturnType<typeof getSupabaseAdminClient>,
): Promise<MailPollChannelResult> {
  const connectedAccountId = ch.arcade_auth_user_id;
  if (!connectedAccountId?.startsWith("ca_")) {
    console.warn(`[mail-poll] ${ch.id}: missing Composio connected account id — reconnect mailbox`);
    return { channel_id: ch.id, inserted: 0, skipped: 0, error: "missing_composio_account" };
  }

  const userId = ch.connected_by_user_id;
  if (!userId) {
    console.warn(`[mail-poll] ${ch.id}: missing connected_by_user_id — reconnect mailbox`);
    return { channel_id: ch.id, inserted: 0, skipped: 0, error: "missing_user_id" };
  }

  const since = ch.last_polled_at ? new Date(ch.last_polled_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const messages =
    ch.source === "gmail"
      ? await fetchGmailMessages(userId, connectedAccountId, since)
      : await fetchOutlookMessages(userId, connectedAccountId, since);

  let inserted = 0;
  let skipped = 0;
  const insertedPayloads: Record<string, unknown>[] = [];

  for (const msg of messages) {
    const payload = await summariseMessage(msg, ch.agent_prompt, ch.source);
    if (!payload) {
      skipped++;
      continue;
    }

    const externalId = msg.id;

    const { error: insErr } = await db.from("genui_l2").insert({
      tenant_id: ch.tenant_id,
      genui_channel_id: ch.id,
      external_event_id: externalId,
      ingest_kind: ch.source === "gmail" ? "gmail_poll" : "outlook_poll",
      generator: "openrouter_ai",
      payload,
      visibility: "private",
      created_by: ch.connected_by_user_id,
      updated_at: new Date().toISOString(),
    });

    if (insErr?.code === "23505") {
      skipped++;
    } else if (insErr) {
      console.error(`[mail-poll] insert error for msg ${externalId}:`, insErr.message);
      skipped++;
    } else {
      inserted++;
      insertedPayloads.push(payload);
    }
  }

  await db
    .from("genui_channels")
    .update({ last_polled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", ch.id);

  // Best-effort: seed grouping config for this kind so the UI sidebar can
  // build sender/chat/etc. sub-lists. No-ops when a row already exists.
  if (inserted > 0) {
    try {
      await ensureKindGrouping(db, ch.source, insertedPayloads);
    } catch (err) {
      console.warn(`[mail-poll] ensureKindGrouping(${ch.source}) failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[mail-poll] ${ch.id} (${ch.source}): inserted=${inserted} skipped=${skipped}`);
  return { channel_id: ch.id, inserted, skipped };
}

type NormalizedMessage = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  body: string;
  date: string;
};

async function fetchGmailMessages(
  userId: string,
  connectedAccountId: string,
  since: Date,
): Promise<NormalizedMessage[]> {
  const { executeComposioTool } = await import("@/lib/composio/execute");
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const data = await executeComposioTool<{
    messages?: Array<{
      messageId?: string;
      subject?: string;
      sender?: string;
      messageText?: string;
      preview?: string;
      messageTimestamp?: string;
    }>;
  }>({
    slug: "GMAIL_FETCH_EMAILS",
    userId,
    connectedAccountId,
    arguments: {
      user_id: "me",
      query: `after:${afterEpoch} in:inbox`,
      max_results: 20,
      verbose: true,
    },
  });

  return (data.messages ?? [])
    .filter((m) => m.messageId)
    .map((m) => ({
      id: m.messageId!,
      subject: m.subject ?? "(no subject)",
      from: m.sender ?? "unknown",
      snippet: m.preview ?? m.messageText?.slice(0, 200) ?? "",
      body: (m.messageText ?? m.preview ?? "").slice(0, 4000),
      date: m.messageTimestamp ?? new Date().toISOString(),
    }));
}

async function fetchOutlookMessages(
  userId: string,
  connectedAccountId: string,
  since: Date,
): Promise<NormalizedMessage[]> {
  const { executeComposioTool } = await import("@/lib/composio/execute");
  const data = await executeComposioTool<{ value?: OutlookMessage[] }>({
    slug: "OUTLOOK_LIST_MESSAGES",
    userId,
    connectedAccountId,
    arguments: {
      folder: "inbox",
      top: 20,
      received_date_time_ge: since.toISOString(),
      orderby: ["receivedDateTime desc"],
      select: ["id", "subject", "from", "bodyPreview", "receivedDateTime", "body"],
      response_detail: "full",
    },
  });

  return (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "(no subject)",
    from: `${m.from?.emailAddress?.name ?? ""} <${m.from?.emailAddress?.address ?? ""}>`.trim(),
    snippet: m.bodyPreview ?? "",
    body: (m.body?.content ?? m.bodyPreview ?? "").slice(0, 4000),
    date: m.receivedDateTime ?? new Date().toISOString(),
  }));
}

/**
 * Extract the email-only form of a `From: Name <addr>` header so the sidebar
 * can group rows by `payload.from_email` with simple SQL equality across
 * "Alice <alice@x.com>", "Alice  <alice@x.com>" etc. Falls back to the raw
 * field (lower-cased) when there are no angle brackets.
 */
export function extractFromEmail(rawFrom: string): string {
  if (!rawFrom) return "";
  const m = rawFrom.match(/<\s*([^>]+)\s*>/);
  const value = m?.[1] ?? rawFrom;
  return value.trim().toLowerCase();
}

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
    const fromRaw = typeof parsed.from === "string" ? parsed.from : msg.from;
    return {
      ...parsed,
      message_id: msg.id,
      source,
      ingest_kind: source === "gmail" ? "gmail_poll" : "outlook_poll",
      from: fromRaw,
      from_email: extractFromEmail(fromRaw),
    };
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
    from_email: extractFromEmail(msg.from),
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
