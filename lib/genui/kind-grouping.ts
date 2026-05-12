/**
 * Per-service-kind grouping for `genui_l2` rows.
 *
 * The sidebar's "leaves" under each kind (Gmail → senders, WhatsApp → chats,
 * Slack → channels) come from a payload field whose name is *not* hardcoded —
 * each service kind owns one row in `public.genui_kind_grouping` that says
 * "for kind X, group by payload field F, sort by T, display via regex R".
 *
 * Lifecycle:
 *   - Seeded for known kinds via migration 20260515120000.
 *   - For new kinds the ingest worker calls `ensureKindGrouping(...)` which
 *     asks the LLM to pick a field, validates it, falls back to a heuristic,
 *     and caches the result.
 *   - The Corn-jobs admin UI can overwrite the row (`confidence: "admin"`) or
 *     `re_infer` it (clears the row so the next ingest tick re-runs inference).
 *
 * Reads use whichever Supabase client the caller has (RLS-readable by every
 * authenticated user). Writes from the ingest worker use the service-role
 * admin client; writes from the admin UI use the authenticated SSR client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type KindGroupingConfidence = "seed" | "ai" | "heuristic" | "admin";

export type KindGrouping = {
  kind: string;
  group_field: string;
  group_label: string;
  timestamp_field: string | null;
  display_regex: string | null;
  confidence: KindGroupingConfidence;
  last_error: string | null;
  updated_at: string;
};

const KIND_GROUPING_TABLE = "genui_kind_grouping";
const KIND_GROUPING_COLUMNS =
  "kind, group_field, group_label, timestamp_field, display_regex, confidence, last_error, updated_at";

/** Lookup a single kind's grouping config; null if not yet inferred. */
export async function loadKindGrouping(
  supabase: SupabaseClient,
  kind: string,
): Promise<KindGrouping | null> {
  const { data, error } = await supabase
    .from(KIND_GROUPING_TABLE)
    .select(KIND_GROUPING_COLUMNS)
    .eq("kind", kind)
    .maybeSingle();
  if (error) {
    console.warn("[kind-grouping] loadKindGrouping:", error.message);
    return null;
  }
  return (data as KindGrouping | null) ?? null;
}

/** Lookup every kind grouping config; used by `/api/sources` to build the tree. */
export async function loadAllKindGroupings(
  supabase: SupabaseClient,
): Promise<Map<string, KindGrouping>> {
  const { data, error } = await supabase
    .from(KIND_GROUPING_TABLE)
    .select(KIND_GROUPING_COLUMNS);
  if (error) {
    console.warn("[kind-grouping] loadAllKindGroupings:", error.message);
    return new Map();
  }
  const map = new Map<string, KindGrouping>();
  for (const row of (data ?? []) as KindGrouping[]) map.set(row.kind, row);
  return map;
}

/**
 * Apply a user/admin-supplied override. Writes with `confidence: "admin"` so
 * subsequent inference passes treat the row as authoritative.
 */
export async function upsertKindGrouping(
  supabase: SupabaseClient,
  input: {
    kind: string;
    group_field: string;
    group_label: string;
    timestamp_field?: string | null;
    display_regex?: string | null;
  },
): Promise<KindGrouping | null> {
  const row = {
    kind: input.kind,
    group_field: input.group_field,
    group_label: input.group_label,
    timestamp_field: input.timestamp_field ?? null,
    display_regex: input.display_regex ?? null,
    confidence: "admin" as KindGroupingConfidence,
    last_error: null,
  };
  const { data, error } = await supabase
    .from(KIND_GROUPING_TABLE)
    .upsert(row, { onConflict: "kind" })
    .select(KIND_GROUPING_COLUMNS)
    .maybeSingle();
  if (error) {
    console.warn("[kind-grouping] upsertKindGrouping:", error.message);
    return null;
  }
  return (data as KindGrouping | null) ?? null;
}

/** Clear a kind's row so the next ingest tick re-runs inference. */
export async function clearKindGrouping(
  supabase: SupabaseClient,
  kind: string,
): Promise<boolean> {
  const { error } = await supabase.from(KIND_GROUPING_TABLE).delete().eq("kind", kind);
  if (error) {
    console.warn("[kind-grouping] clearKindGrouping:", error.message);
    return false;
  }
  return true;
}

// ─── inference ─────────────────────────────────────────────────────────────

type SamplePayload = Record<string, unknown>;

/**
 * Ensure a grouping row exists for this `kind`. Returns the cached row when one
 * is present; otherwise runs LLM inference, falls back to a heuristic, persists
 * the result, and returns it. Designed to be called from the ingest worker
 * with the payloads it just inserted as samples.
 */
export async function ensureKindGrouping(
  supabase: SupabaseClient,
  kind: string,
  samples: SamplePayload[],
): Promise<KindGrouping | null> {
  const existing = await loadKindGrouping(supabase, kind);
  if (existing) return existing;
  if (samples.length === 0) return null;

  const llm = await inferKindGroupingViaLlm(kind, samples);
  if (llm) {
    return await persistKindGrouping(supabase, {
      kind,
      group_field: llm.group_field,
      group_label: llm.group_label,
      timestamp_field: llm.timestamp_field ?? null,
      display_regex: llm.display_regex ?? null,
      confidence: "ai",
      last_error: null,
    });
  }

  const heuristic = inferKindGroupingHeuristic(kind, samples);
  if (heuristic) {
    return await persistKindGrouping(supabase, {
      kind,
      group_field: heuristic.group_field,
      group_label: heuristic.group_label,
      timestamp_field: heuristic.timestamp_field,
      display_regex: null,
      confidence: "heuristic",
      last_error: "LLM inference failed; using heuristic fallback.",
    });
  }

  return null;
}

async function persistKindGrouping(
  supabase: SupabaseClient,
  row: {
    kind: string;
    group_field: string;
    group_label: string;
    timestamp_field: string | null;
    display_regex: string | null;
    confidence: KindGroupingConfidence;
    last_error: string | null;
  },
): Promise<KindGrouping | null> {
  const { data, error } = await supabase
    .from(KIND_GROUPING_TABLE)
    .upsert(row, { onConflict: "kind" })
    .select(KIND_GROUPING_COLUMNS)
    .maybeSingle();
  if (error) {
    console.warn("[kind-grouping] persist:", error.message);
    return null;
  }
  return (data as KindGrouping | null) ?? null;
}

type LlmResult = {
  group_field: string;
  group_label: string;
  timestamp_field: string | null;
  display_regex: string | null;
};

async function inferKindGroupingViaLlm(
  kind: string,
  samples: SamplePayload[],
): Promise<LlmResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";

  const trimmed = samples.slice(0, 10).map(redactPayload);
  const fieldHints = collectStringFieldCoverage(trimmed);

  const prompt = [
    `You are configuring a sidebar grouping for the service "${kind}".`,
    "Each payload below is one synthesised event from that service.",
    "Pick ONE field from the payloads to group events on so that all events sharing",
    "the same value belong together (e.g. all emails from the same sender, all",
    "messages in the same chat, all PRs in the same repo).",
    "",
    "Constraints:",
    "- The field MUST appear as a string in the majority of samples.",
    "- Prefer fields with clean, normalised values (e.g. \"from_email\" over \"from\").",
    "- group_label is a short human label like \"Sender\", \"Chat\", \"Repository\".",
    "- timestamp_field is OPTIONAL — set it to a payload field that holds the",
    "  event's timestamp so groups can be sorted by recency, or null.",
    "- display_regex is OPTIONAL — set it to a JS-style regex with ONE capture",
    "  group when raw values need cleanup for display (e.g. extract email from",
    "  \"Name <email>\"); otherwise null.",
    "",
    `String fields and their coverage in samples: ${JSON.stringify(fieldHints)}`,
    "",
    "Samples (JSON array):",
    JSON.stringify(trimmed, null, 1),
    "",
    "Return JSON only:",
    '{"group_field":"<field>","group_label":"<label>","timestamp_field":"<field|null>","display_regex":"<regex|null>"}',
  ].join("\n");

  const tryCall = async (extraInstruction?: string): Promise<LlmResult | null> => {
    const messages = [
      { role: "system", content: "You are a strict JSON generator. Output valid JSON only." },
      { role: "user", content: extraInstruction ? `${prompt}\n\nFurther: ${extraInstruction}` : prompt },
    ];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.1 }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? "";
      const parsed = parseLlmJson(content);
      return validateLlmResult(parsed, trimmed);
    } catch {
      return null;
    }
  };

  const first = await tryCall();
  if (first) return first;
  return await tryCall(
    "Your previous response was rejected. Pick a field that exists as a non-empty string in at least half the samples and is a valid JSON key.",
  );
}

function parseLlmJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function validateLlmResult(parsed: unknown, samples: SamplePayload[]): LlmResult | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const group_field = typeof obj.group_field === "string" ? obj.group_field.trim() : "";
  const group_label = typeof obj.group_label === "string" ? obj.group_label.trim() : "";
  if (!group_field || !group_label) return null;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(group_field)) return null;

  const coverage = samples.reduce(
    (acc, s) => (typeof s?.[group_field] === "string" && (s[group_field] as string).length > 0 ? acc + 1 : acc),
    0,
  );
  if (coverage / Math.max(samples.length, 1) < 0.5) return null;

  let timestamp_field: string | null = null;
  if (typeof obj.timestamp_field === "string" && obj.timestamp_field.trim() && obj.timestamp_field !== "null") {
    timestamp_field = obj.timestamp_field.trim();
  }

  let display_regex: string | null = null;
  if (typeof obj.display_regex === "string" && obj.display_regex.trim() && obj.display_regex !== "null") {
    display_regex = obj.display_regex.trim();
    try {
      new RegExp(display_regex);
    } catch {
      display_regex = null;
    }
  }

  return { group_field, group_label, timestamp_field, display_regex };
}

function collectStringFieldCoverage(samples: SamplePayload[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of samples) {
    if (!s || typeof s !== "object") continue;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "string" && v.length > 0) counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

const HEURISTIC_FIELD_PRIORITY: Array<{ field: string; label: string; timestamp?: string }> = [
  { field: "from_email", label: "Sender", timestamp: "date" },
  { field: "from", label: "Sender", timestamp: "date" },
  { field: "sender", label: "Sender", timestamp: "date" },
  { field: "chat_slug", label: "Chat", timestamp: "ts_raw" },
  { field: "chat", label: "Chat", timestamp: "ts_raw" },
  { field: "channel", label: "Channel", timestamp: "ts" },
  { field: "repo", label: "Repository", timestamp: "created_at" },
  { field: "repository", label: "Repository", timestamp: "created_at" },
  { field: "list", label: "List", timestamp: "created_at" },
  { field: "list_id", label: "List", timestamp: "created_at" },
  { field: "project", label: "Project", timestamp: "created_at" },
  { field: "author", label: "Author", timestamp: "created_at" },
  { field: "thread_id", label: "Thread", timestamp: "created_at" },
];

const HEURISTIC_BLACKLIST = new Set([
  "id",
  "message_id",
  "external_event_id",
  "summary",
  "raw_snippet",
  "body",
  "snippet",
  "ingest_kind",
  "generator",
  "subject",
]);

/**
 * Pick a grouping field by inspecting the samples — used as a fallback when
 * the LLM call fails. Prefers known field names; otherwise the highest-coverage
 * non-id string field with at least 2 distinct values across samples.
 */
export function inferKindGroupingHeuristic(
  _kind: string,
  samples: SamplePayload[],
): { group_field: string; group_label: string; timestamp_field: string | null } | null {
  if (samples.length === 0) return null;

  // 1. Priority hits — first known field that has ≥50 % coverage wins.
  for (const candidate of HEURISTIC_FIELD_PRIORITY) {
    const coverage = samples.filter((s) => typeof s?.[candidate.field] === "string" && (s[candidate.field] as string).length > 0).length;
    if (coverage / samples.length >= 0.5) {
      return {
        group_field: candidate.field,
        group_label: candidate.label,
        timestamp_field: candidate.timestamp ?? null,
      };
    }
  }

  // 2. Highest-coverage non-blacklisted string field with ≥ 2 distinct values.
  const coverage = collectStringFieldCoverage(samples);
  const candidates = Object.entries(coverage)
    .filter(([k]) => !HEURISTIC_BLACKLIST.has(k))
    .filter(([k]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
    .sort((a, b) => b[1] - a[1]);
  for (const [field] of candidates) {
    const values = new Set(samples.map((s) => s?.[field]).filter((v) => typeof v === "string" && (v as string).length > 0));
    if (values.size >= 2) {
      return { group_field: field, group_label: humanizeLabel(field), timestamp_field: pickTimestampField(samples) };
    }
  }

  return null;
}

function humanizeLabel(field: string): string {
  return field
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function pickTimestampField(samples: SamplePayload[]): string | null {
  const candidates = ["date", "created_at", "ts", "ts_raw", "timestamp", "received_at"];
  for (const c of candidates) {
    const has = samples.some((s) => typeof s?.[c] === "string");
    if (has) return c;
  }
  return null;
}

function redactPayload(payload: SamplePayload): SamplePayload {
  // Trim verbose body fields so the LLM context stays small and free-of-PII-ish.
  const redacted: SamplePayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && v.length > 200 && /body|content|html/.test(k)) {
      redacted[k] = `${v.slice(0, 60)}…`;
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      redacted[k] = v;
    } else if (Array.isArray(v)) {
      redacted[k] = v.slice(0, 5);
    } else if (typeof v === "object") {
      redacted[k] = v; // small nested objects pass through
    }
  }
  return redacted;
}

// ─── key format + display helpers ──────────────────────────────────────────

export const GROUP_KEY_SEPARATOR = "::";
export const GROUP_OTHER_VALUE = "__other__";

export function formatGroupKey(kind: string, groupField: string, groupValue: string): string {
  return `${kind}${GROUP_KEY_SEPARATOR}${groupField}=${groupValue}`;
}

export function parseGroupKey(
  key: string,
): { kind: string; group_field: string; group_value: string } | null {
  const sepIdx = key.indexOf(GROUP_KEY_SEPARATOR);
  if (sepIdx <= 0) return null;
  const kind = key.slice(0, sepIdx);
  const rest = key.slice(sepIdx + GROUP_KEY_SEPARATOR.length);
  const eqIdx = rest.indexOf("=");
  if (eqIdx <= 0) return null;
  const group_field = rest.slice(0, eqIdx);
  const group_value = rest.slice(eqIdx + 1);
  if (!kind || !group_field) return null;
  return { kind, group_field, group_value };
}

export function isGroupKey(key: string): boolean {
  return key.includes(GROUP_KEY_SEPARATOR);
}

/**
 * Pick a display label for a group value. Applies `display_regex` (one capture
 * group) when provided; otherwise returns the raw value (or "Other" for the
 * empty bucket).
 */
export function formatGroupDisplay(rawValue: string | null, grouping: Pick<KindGrouping, "display_regex">): string {
  if (rawValue === null || rawValue === "" || rawValue === GROUP_OTHER_VALUE) return "Other";
  const re = grouping.display_regex;
  if (!re) return rawValue;
  try {
    const match = rawValue.match(new RegExp(re));
    if (match && match[1]) return match[1];
  } catch {
    /* malformed regex — fall through */
  }
  return rawValue;
}
