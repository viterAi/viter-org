/**
 * Day scoper — return all L1 turn_text events for a given calendar day (Asia/Jerusalem).
 *
 * Critical: filters to ACTIVE extraction runs only. Without that join, superseded runs'
 * events would appear in the synthesis (history pollution).
 *
 * Tool calls (facet='tool_calls') are excluded by default — they're noisy and rarely
 * what an L2 day synthesis wants. Pass {includeToolCalls: true} to include.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { L1EventForPrompt, ScoperInput } from '../types.js';

interface DayScoperOptions {
  /** YYYY-MM-DD scopeKey is interpreted in this timezone. Default Asia/Jerusalem. */
  timezone?: string;
  includeToolCalls?: boolean;
}

export async function scopeByDay(
  input: ScoperInput,
  db: SupabaseClient,
  opts: DayScoperOptions = {},
): Promise<L1EventForPrompt[]> {
  const tz = opts.timezone ?? 'Asia/Jerusalem';
  const facets = opts.includeToolCalls ? ['turn_text', 'tool_calls'] : ['turn_text'];

  // YYYY-MM-DD → start + end as UTC instants for the given tz
  const dayStr = input.scopeKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
    throw new Error(`day scoper: scopeKey must be YYYY-MM-DD, got '${dayStr}'`);
  }
  const dayStart = ymdToTzMidnight(dayStr, tz);
  const nextDay = ymdToTzMidnight(addDays(dayStr, 1), tz);

  // Active-runs-only via subquery: match (tenant, artifact, facet) → active_run_id
  // RPC would be cleaner but works fine with a CTE-ish join here.
  const { data, error } = await db.rpc('scope_by_day', {
    p_tenant_id: input.tenantId,
    p_start: dayStart.toISOString(),
    p_end: nextDay.toISOString(),
    p_facets: facets,
  });

  if (error) {
    // RPC may not exist; fall back to inline query for v0.1
    return await scopeByDayInline({
      tenantId: input.tenantId,
      startIso: dayStart.toISOString(),
      endIso: nextDay.toISOString(),
      facets,
      db,
    });
  }
  return (data as L1EventForPrompt[]) ?? [];
}

async function scopeByDayInline(args: {
  tenantId: string;
  startIso: string;
  endIso: string;
  facets: string[];
  db: SupabaseClient;
}): Promise<L1EventForPrompt[]> {
  const { tenantId, startIso, endIso, facets, db } = args;

  // 1. fetch active_extraction_run_ids for any artifact that has events in window
  //    (we'll do this via a single query joining events → active extraction by run match)
  const { data: rows, error } = await db
    .from('l1_events')
    .select(
      `
      id, extraction_run_id, event_at, facet, modality, content, position, artifact_id, metadata,
      principals!actor_id ( canonical_id, display_name ),
      channels!channel_id  ( kind, identifier )
    `,
    )
    .eq('tenant_id', tenantId)
    .in('facet', facets)
    .gte('event_at', startIso)
    .lt('event_at', endIso)
    .order('event_at', { ascending: true })
    .order('position', { ascending: true });

  if (error) throw new Error(`scopeByDay: ${error.message}`);
  if (!rows) return [];

  // Filter to active runs only (post-filter; ideal would be in-query but supabase-js join syntax limits us)
  // Get active runs for the artifact_ids in our window
  const artifactIds = Array.from(new Set(rows.map((r: any) => r.artifact_id as string)));
  if (artifactIds.length === 0) return [];

  const { data: activeRows, error: activeErr } = await db
    .from('l1_active_extraction')
    .select('artifact_id, facet, active_run_id')
    .eq('tenant_id', tenantId)
    .in('artifact_id', artifactIds)
    .in('facet', facets);

  if (activeErr) throw new Error(`scopeByDay active lookup: ${activeErr.message}`);

  const activeKey = new Set(
    (activeRows ?? []).map((a: any) => `${a.artifact_id}::${a.facet}::${a.active_run_id}`),
  );

  return rows
    .filter((r: any) =>
      activeKey.has(`${r.artifact_id}::${r.facet}::${r.extraction_run_id}`),
    )
    .map((r: any) => ({
      id: r.id,
      extraction_run_id: r.extraction_run_id,
      event_at: r.event_at,
      facet: r.facet,
      modality: r.modality,
      content: r.content,
      position: r.position,
      artifact_id: r.artifact_id,
      actor_id: (r as any).actor_id ?? null,
      actor_canonical: r.principals?.canonical_id ?? null,
      actor_display: r.principals?.display_name ?? null,
      channel_kind: r.channels?.kind ?? null,
      channel_identifier: r.channels?.identifier ?? null,
      metadata: r.metadata ?? {},
    }));
}

// ────────────────────────────────────────────────────────────────────
// Time helpers
// ────────────────────────────────────────────────────────────────────

function ymdToTzMidnight(ymd: string, timezone: string): Date {
  // Parse "YYYY-MM-DD" as midnight in the given timezone, return as Date (UTC instant).
  // Trick: create a Date assuming the LOCAL midnight, then offset by the tz's UTC offset for that date.
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  // Build a UTC date for the literal y/m/d, then we'll compute the tz offset at that moment.
  const naiveUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Compute what the tz says the wall-clock is at naiveUtc:
  const tzWallStr = naiveUtc.toLocaleString('en-US', { timeZone: timezone, hour12: false });
  // Parse it back
  const [datePart, timePart] = tzWallStr.split(', ');
  const [mm, dd, yyyy] = (datePart ?? '').split('/').map(Number);
  const [hh, mi, ss] = (timePart ?? '0:0:0').split(':').map(Number);
  const tzWall = new Date(Date.UTC(yyyy ?? y, (mm ?? m) - 1, dd ?? d, hh ?? 0, mi ?? 0, ss ?? 0));
  // The offset is naiveUtc - tzWall; subtract it from naiveUtc to get true UTC for that wall time
  const offsetMs = naiveUtc.getTime() - tzWall.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
