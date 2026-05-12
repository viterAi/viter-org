/**
 * Admin endpoints for `public.genui_kind_grouping` — the per-service-kind
 * configuration that drives sidebar grouping (Gmail → senders, etc.).
 *
 * `GET`  → list every cached row (RLS-readable to authenticated users).
 * `POST` → either:
 *           • `{ re_infer: true, kind }`            — clear the row so the
 *             next ingest tick re-runs `ensureKindGrouping()`.
 *           • `{ kind, group_field, group_label,
 *               timestamp_field?, display_regex? }` — upsert with
 *             `confidence: "admin"`.
 *
 * Reads use the SSR Supabase client so RLS naturally scopes; writes also use
 * RLS (`authenticated` → write allowed) — multi-tenant override splits are a
 * future concern (see plan-doc §8.2).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  clearKindGrouping,
  loadAllKindGroupings,
  upsertKindGrouping,
} from "@/lib/genui/kind-grouping";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const map = await loadAllKindGroupings(supabase);
  return NextResponse.json({ groupings: Array.from(map.values()) });
}

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const overrideSchema = z.object({
  kind: z.string().min(1).max(64),
  group_field: z.string().regex(FIELD_RE, "must be a JSON field name (a–z, A–Z, 0–9, _)"),
  group_label: z.string().min(1).max(64),
  timestamp_field: z.string().regex(FIELD_RE).optional().nullable(),
  display_regex: z
    .string()
    .min(1)
    .optional()
    .nullable()
    .refine((s) => {
      if (!s) return true;
      try {
        new RegExp(s);
        return true;
      } catch {
        return false;
      }
    }, "must be a valid regex"),
});

const reInferSchema = z.object({
  kind: z.string().min(1).max(64),
  re_infer: z.literal(true),
});

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const reInfer = reInferSchema.safeParse(body);
  if (reInfer.success) {
    const ok = await clearKindGrouping(supabase, reInfer.data.kind);
    if (!ok) return NextResponse.json({ error: "delete failed" }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: reInfer.data.kind });
  }

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", details: parsed.error.format() }, { status: 400 });
  }

  const row = await upsertKindGrouping(supabase, {
    kind: parsed.data.kind,
    group_field: parsed.data.group_field,
    group_label: parsed.data.group_label,
    timestamp_field: parsed.data.timestamp_field ?? null,
    display_regex: parsed.data.display_regex ?? null,
  });
  if (!row) return NextResponse.json({ error: "upsert failed" }, { status: 500 });

  return NextResponse.json({ ok: true, grouping: row });
}
