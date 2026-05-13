import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureKindGrouping } from "@/lib/genui/kind-grouping";
import { resolveGenuiL2Writer, resolveGenuiWorkerJwtClient } from "@/lib/genui/l2-writer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type IngestJobResult = {
  job_id: string;
  channel_id: string;
  status: "done" | "failed" | "skipped";
  error?: string;
};

export type IngestWorkerRunResult = {
  ok: boolean;
  processed: number;
  results: IngestJobResult[];
  error?: string;
};

const LAST_N = Math.max(1, Math.min(50, parseInt(process.env.GENUI_LAST_N ?? "10", 10) || 10));
const MAX_JOBS_PER_RUN = Math.max(1, Math.min(20, parseInt(process.env.GENUI_INGEST_MAX_JOBS ?? "5", 10) || 5));

type IngestJob = {
  id: string;
  tenant_id: string;
  genui_channel_id: string;
  ingest_kind: string;
  raw_body: string;
};

type L2Row = {
  id: string;
  payload: unknown;
  created_at: string;
  generator: string | null;
};

/**
 * Claim pending `genui_ingest_jobs` (GitHub webhooks), synthesize payloads, insert `genui_l2`.
 * Mirrors `vita-compare/packages/runtime/scripts/genui-ingest-worker.ts` for Corn jobs cron.
 */
export async function runGenuiIngestWorker(): Promise<IngestWorkerRunResult> {
  const workerDb = await resolveGenuiWorkerJwtClient();
  const l2Writer = await resolveGenuiL2Writer();
  const admin = getSupabaseAdminClient();

  if (!l2Writer) {
    return {
      ok: false,
      processed: 0,
      results: [],
      error:
        "Missing genUI L2 writer (GENUI_L2_ATTRIBUTED_USER_ID or GENUI_WORKER_EMAIL/PASSWORD + L0 Supabase URL/anon key)",
    };
  }

  const db = workerDb ?? admin;
  const tenantFilter = process.env.GENUI_WORKER_TENANT_ID?.trim() || null;

  const results: IngestJobResult[] = [];
  let processed = 0;

  while (processed < MAX_JOBS_PER_RUN) {
    const tenantIds = await pendingTenantIds(admin, tenantFilter);
    if (tenantIds.length === 0) break;

    let claimedAny = false;
    for (const tenantId of tenantIds) {
      if (processed >= MAX_JOBS_PER_RUN) break;

      let job: IngestJob | null;
      try {
        job = await claimNextJob(workerDb, admin, tenantId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ job_id: "", channel_id: "", status: "failed", error: msg });
        continue;
      }
      if (!job) continue;

      claimedAny = true;
      const result = await processJob(db, l2Writer, job, workerDb ? null : admin);
      results.push(result);
      if (result.status !== "skipped") processed++;
    }

    if (!claimedAny) break;
  }

  return { ok: true, processed, results };
}

async function pendingTenantIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  tenantFilter: string | null,
): Promise<string[]> {
  let query = admin.from("genui_ingest_jobs").select("tenant_id").eq("status", "pending");
  if (tenantFilter) query = query.eq("tenant_id", tenantFilter);
  const { data, error } = await query;
  if (error) {
    console.error("[genui-ingest] pending tenant lookup failed:", error.message);
    return tenantFilter ? [tenantFilter] : [];
  }
  return [...new Set((data ?? []).map((r) => r.tenant_id as string))];
}

async function claimNextJob(
  workerDb: SupabaseClient | null,
  admin: ReturnType<typeof getSupabaseAdminClient>,
  tenantId: string,
): Promise<IngestJob | null> {
  if (workerDb) {
    const { data, error } = await workerDb
      .rpc("genui_claim_next_job", { p_tenant_id: tenantId })
      .maybeSingle<IngestJob>();
    if (error) throw new Error(`claim(${tenantId}): ${error.message}`);
    return data;
  }

  const { data: job } = await admin
    .from("genui_ingest_jobs")
    .select("id, tenant_id, genui_channel_id, ingest_kind, raw_body")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job) return null;

  const { data: updated } = await admin
    .from("genui_ingest_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id, tenant_id, genui_channel_id, ingest_kind, raw_body")
    .maybeSingle();

  return (updated as IngestJob | null) ?? null;
}

async function processJob(
  db: SupabaseClient,
  l2Writer: NonNullable<Awaited<ReturnType<typeof resolveGenuiL2Writer>>>,
  row: IngestJob,
  jobAdmin: ReturnType<typeof getSupabaseAdminClient> | null,
): Promise<IngestJobResult> {
  const jobDb = jobAdmin ?? db;
  const base = { job_id: row.id, channel_id: row.genui_channel_id };

  const { data: chRow, error: chErr } = await db
    .from("genui_channels")
    .select("agent_prompt, source")
    .eq("id", row.genui_channel_id)
    .single();

  if (chErr) {
    await markFailed(jobDb, row.id, chErr.message);
    return { ...base, status: "failed", error: chErr.message };
  }

  const agentGoal = String((chRow as { agent_prompt?: string })?.agent_prompt ?? "").trim();
  const channelSource = String((chRow as { source?: string })?.source ?? "github");

  const { data: lastRows, error: lrErr } = await db
    .from("genui_l2")
    .select("id, payload, created_at, generator")
    .eq("genui_channel_id", row.genui_channel_id)
    .order("created_at", { ascending: false })
    .limit(LAST_N);

  if (lrErr) {
    await markFailed(jobDb, row.id, lrErr.message);
    return { ...base, status: "failed", error: lrErr.message };
  }

  let payload: Record<string, unknown>;
  try {
    payload = await buildPayload(row, lastRows ?? [], agentGoal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markFailed(jobDb, row.id, msg);
    return { ...base, status: "failed", error: msg };
  }

  const insertBase = {
    tenant_id: row.tenant_id,
    genui_channel_id: row.genui_channel_id,
    generator: "genui-ingest",
    visibility: "tenant" as const,
    payload,
  };

  const { error: insErr } =
    l2Writer.mode === "service_role"
      ? await l2Writer.client.from("genui_l2").insert({
          ...insertBase,
          created_by: l2Writer.attributedUserId,
        })
      : await l2Writer.client.from("genui_l2").insert(insertBase);

  if (insErr) {
    await markFailed(jobDb, row.id, insErr.message);
    return { ...base, status: "failed", error: insErr.message };
  }

  const { error: doneErr } = await jobDb
    .from("genui_ingest_jobs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", row.id);

  if (doneErr) {
    return { ...base, status: "failed", error: doneErr.message };
  }

  try {
    await ensureKindGrouping(db, channelSource, [payload]);
  } catch {
    // grouping is best-effort
  }

  return { ...base, status: "done" };
}

async function markFailed(workerDb: SupabaseClient, jobId: string, message: string) {
  await workerDb
    .from("genui_ingest_jobs")
    .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function buildPayload(
  job: Pick<IngestJob, "ingest_kind" | "raw_body">,
  lastN: L2Row[],
  agentGoal: string,
): Promise<Record<string, unknown>> {
  const base = {
    schema_version: 1,
    ingest_kind: job.ingest_kind,
    last_n_count: lastN.length,
    synthesized_at: new Date().toISOString(),
    agent_goal: agentGoal,
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return {
      ...base,
      stub: true,
      summary: "Set OPENROUTER_API_KEY to enable LLM synthesis.",
      raw_preview: job.raw_body.slice(0, 2000),
    };
  }

  const model = process.env.OPENROUTER_MODEL ?? process.env.GENUI_OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const goalLine =
    agentGoal.length > 0
      ? `The user-defined goal for this GitHub connection:\n${agentGoal}\n\n`
      : "No explicit user goal was set; infer intent from the webhook payload.\n\n";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `${goalLine}You help genUI ingest. Reply with a single JSON object only, keys: summary (string), highlights (string array, max 8). Stay aligned with the user goal above.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            prior_genui_l2: lastN.map((r) => ({
              id: r.id,
              created_at: r.created_at,
              generator: r.generator,
              payload: r.payload,
            })),
            github_webhook_json: safeJsonParse(job.raw_body),
          }),
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 500)}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  let parsed: { summary?: string; highlights?: string[] };
  try {
    parsed = JSON.parse(text) as { summary?: string; highlights?: string[] };
  } catch {
    parsed = { summary: text.slice(0, 500), highlights: [] };
  }

  return {
    ...base,
    summary: parsed.summary ?? "",
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 8) : [],
    model,
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return { parse_error: true, raw_slice: s.slice(0, 500) };
  }
}
