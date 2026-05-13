/**
 * Helpers for sourcing UI data from the `genui_channels` + `genui_l2` tables.
 *
 * All reads happen through the SSR Supabase client so RLS enforces access:
 * channels are visible to their **connected user** (or tenant admins); L2 rows
 * use visibility + `created_by` (see `genui_l2` policies). We never pass
 * `tenant_id` manually for reads — Postgres applies policies from `auth.uid()`.
 *
 * Two key formats exist:
 *   • Channel key  — `<source>:<external_key>` (e.g. `gmail:yy@upvlu.com`).
 *                    Points at ONE row in `genui_channels`. Today's fallback
 *                    when no grouping is configured.
 *   • Group key    — `<kind>::<group_field>=<group_value>` (e.g.
 *                    `gmail::from_email=alice@x.com`). Kind-scoped — merges
 *                    L2 rows across every channel of that kind for the user.
 *
 * Routes call `resolveSourceKey()` which returns a single context shape and
 * doesn't care which format the key was in.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceDataRow } from "../types/view-builder";
import {
  GROUP_KEY_SEPARATOR,
  GROUP_OTHER_VALUE,
  formatGroupDisplay,
  formatGroupKey,
  isGroupKey,
  loadAllKindGroupings,
  loadKindGrouping,
  parseGroupKey,
  type KindGrouping,
} from "./kind-grouping";

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_MAX_DAYS = 30;
const DEFAULT_GROUPING_FETCH_ROWS = 500;

export type GenuiChannelRow = {
  id: string;
  source: string;
  external_key: string;
  display_name: string | null;
  created_at: string;
};

export type GenuiL2Row = {
  id: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

export type UiSource = {
  id: string;
  name: string;
  key: string;
  channel: string;
};

export type SourceGroup = {
  id: string;
  name: string;
  key: string;
  channel: string;
  group_field: string;
  group_value: string;
  message_count: number;
  latest_at: string | null;
  is_other?: boolean;
};

export type SourceTreeNode = {
  kind: string;
  channels: UiSource[];
  grouping: KindGrouping | null;
  groups: SourceGroup[];
};

/** Stable composite key used in URLs, localStorage, and `views.source_id`. */
export function channelToSourceKey(channel: Pick<GenuiChannelRow, "source" | "external_key">): string {
  return `${channel.source}:${channel.external_key}`;
}

/**
 * Split a stable source key into `channel` or `group` parts. `channel` keys
 * are `<source>:<external_key>`; `group` keys use `::` as the separator and
 * contain `=` (`<kind>::<field>=<value>`).
 */
export function parseSourceKey(
  key: string,
):
  | { type: "channel"; source: string; external_key: string }
  | { type: "group"; kind: string; group_field: string; group_value: string }
  | null {
  if (isGroupKey(key)) {
    const parsed = parseGroupKey(key);
    if (!parsed) return null;
    return { type: "group", ...parsed };
  }
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) return null;
  return {
    type: "channel",
    source: key.slice(0, idx),
    external_key: key.slice(idx + 1),
  };
}

/** Map a `genui_channels` row to the UI `Source` shape. */
export function channelToUiSource(channel: GenuiChannelRow): UiSource {
  const key = channelToSourceKey(channel);
  return {
    id: key,
    key,
    name: channel.display_name ?? channel.external_key,
    channel: channel.source,
  };
}

/**
 * List every `genui_channels` row the caller can see (RLS-scoped).
 * Returns them sorted by creation time desc so newest connections appear first.
 */
export async function listVisibleChannels(supabase: SupabaseClient): Promise<GenuiChannelRow[]> {
  const { data, error } = await supabase
    .from("genui_channels")
    .select("id, source, external_key, display_name, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[l2-source] listVisibleChannels:", error.message);
    return [];
  }
  return (data ?? []) as GenuiChannelRow[];
}

/**
 * Resolve a channel-form key to the underlying channel row (RLS-scoped).
 * Returns null when the key is malformed or the channel is not visible.
 */
export async function resolveChannelByKey(
  supabase: SupabaseClient,
  sourceKey: string,
): Promise<GenuiChannelRow | null> {
  const parsed = parseSourceKey(sourceKey);
  if (!parsed || parsed.type !== "channel") return null;

  const { data, error } = await supabase
    .from("genui_channels")
    .select("id, source, external_key, display_name, created_at")
    .eq("source", parsed.source)
    .eq("external_key", parsed.external_key)
    .maybeSingle();

  if (error) {
    console.warn("[l2-source] resolveChannelByKey:", error.message);
    return null;
  }
  return (data as GenuiChannelRow | null) ?? null;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cutoffIso(maxDays: number): string {
  return new Date(Date.now() - maxDays * 86_400_000).toISOString();
}

/**
 * Fetch the most recent `genui_l2` rows for a channel — capped at
 * `min(GENUI_L2_MAX_ROWS, last GENUI_L2_MAX_DAYS days)`. RLS enforces tenant
 * membership and per-row visibility automatically.
 */
export async function fetchL2RowsForChannel(
  supabase: SupabaseClient,
  channelId: string,
): Promise<GenuiL2Row[]> {
  const maxRows = envInt("GENUI_L2_MAX_ROWS", DEFAULT_MAX_ROWS);
  const maxDays = envInt("GENUI_L2_MAX_DAYS", DEFAULT_MAX_DAYS);

  const { data, error } = await supabase
    .from("genui_l2")
    .select("id, created_at, payload")
    .eq("genui_channel_id", channelId)
    .gte("created_at", cutoffIso(maxDays))
    .order("created_at", { ascending: false })
    .limit(maxRows);

  if (error) {
    console.warn("[l2-source] fetchL2RowsForChannel:", error.message);
    return [];
  }
  return (data ?? []) as GenuiL2Row[];
}

/**
 * Fetch capped L2 rows for a kind-scoped group. Joins to `genui_channels`
 * (RLS-scoped) so only the user's channels of `kind` contribute.
 *
 * When `group_value === GROUP_OTHER_VALUE` the filter matches NULL or empty
 * string values — that's the "Other" bucket.
 */
export async function fetchL2RowsForGroup(
  supabase: SupabaseClient,
  args: { kind: string; group_field: string; group_value: string },
): Promise<{ rows: GenuiL2Row[]; channelIds: string[] }> {
  const channels = await listChannelsForKind(supabase, args.kind);
  if (channels.length === 0) return { rows: [], channelIds: [] };

  const maxRows = envInt("GENUI_L2_MAX_ROWS", DEFAULT_MAX_ROWS);
  const maxDays = envInt("GENUI_L2_MAX_DAYS", DEFAULT_MAX_DAYS);
  const channelIds = channels.map((c) => c.id);

  const baseQuery = supabase
    .from("genui_l2")
    .select("id, created_at, payload")
    .in("genui_channel_id", channelIds)
    .gte("created_at", cutoffIso(maxDays))
    .order("created_at", { ascending: false })
    .limit(maxRows);

  const filtered =
    args.group_value === GROUP_OTHER_VALUE
      ? baseQuery.or(`payload->>${args.group_field}.is.null,payload->>${args.group_field}.eq.`)
      : baseQuery.eq(`payload->>${args.group_field}`, args.group_value);

  const { data, error } = await filtered;
  if (error) {
    console.warn("[l2-source] fetchL2RowsForGroup:", error.message);
    return { rows: [], channelIds };
  }
  return { rows: (data ?? []) as GenuiL2Row[], channelIds };
}

/** List every visible channel of a given kind, sorted newest first. */
export async function listChannelsForKind(
  supabase: SupabaseClient,
  kind: string,
): Promise<GenuiChannelRow[]> {
  const { data, error } = await supabase
    .from("genui_channels")
    .select("id, source, external_key, display_name, created_at")
    .eq("source", kind)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[l2-source] listChannelsForKind:", error.message);
    return [];
  }
  return (data ?? []) as GenuiChannelRow[];
}

/**
 * Build the list of groups for a given kind from the user's accessible L2
 * rows. Returns groups sorted by their latest row's `created_at` desc, with
 * `is_other: true` set on the bucket that holds rows missing the field.
 */
export async function listGroupsForKind(
  supabase: SupabaseClient,
  grouping: KindGrouping,
): Promise<SourceGroup[]> {
  const channels = await listChannelsForKind(supabase, grouping.kind);
  if (channels.length === 0) return [];

  const channelIds = channels.map((c) => c.id);
  const maxRows = envInt("GENUI_L2_GROUPING_MAX_ROWS", DEFAULT_GROUPING_FETCH_ROWS);
  const maxDays = envInt("GENUI_L2_MAX_DAYS", DEFAULT_MAX_DAYS);

  const { data, error } = await supabase
    .from("genui_l2")
    .select("id, created_at, payload")
    .in("genui_channel_id", channelIds)
    .gte("created_at", cutoffIso(maxDays))
    .order("created_at", { ascending: false })
    .limit(maxRows);

  if (error) {
    console.warn("[l2-source] listGroupsForKind:", error.message);
    return [];
  }

  const buckets = new Map<string, { count: number; latest_at: string; raw_value: string | null }>();
  for (const row of (data ?? []) as GenuiL2Row[]) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const v = payload[grouping.group_field];
    const isStringValue = typeof v === "string" && v.length > 0;
    const bucketKey = isStringValue ? (v as string) : GROUP_OTHER_VALUE;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.count += 1;
      if (row.created_at > existing.latest_at) existing.latest_at = row.created_at;
    } else {
      buckets.set(bucketKey, { count: 1, latest_at: row.created_at, raw_value: isStringValue ? (v as string) : null });
    }
  }

  const groups: SourceGroup[] = [];
  for (const [bucketKey, info] of buckets.entries()) {
    const isOther = bucketKey === GROUP_OTHER_VALUE;
    const key = formatGroupKey(grouping.kind, grouping.group_field, isOther ? GROUP_OTHER_VALUE : bucketKey);
    groups.push({
      id: key,
      key,
      channel: grouping.kind,
      group_field: grouping.group_field,
      group_value: isOther ? GROUP_OTHER_VALUE : bucketKey,
      name: formatGroupDisplay(info.raw_value, grouping),
      message_count: info.count,
      latest_at: info.latest_at,
      ...(isOther ? { is_other: true } : {}),
    });
  }

  groups.sort((a, b) => {
    if (a.is_other && !b.is_other) return 1;
    if (!a.is_other && b.is_other) return -1;
    const ta = a.latest_at ?? "";
    const tb = b.latest_at ?? "";
    if (ta && tb) return tb.localeCompare(ta);
    return a.name.localeCompare(b.name);
  });

  return groups;
}

/**
 * Flatten a list of L2 rows into the row shape the AI page-composer expects.
 * Raw `payload` keys win at the top level; `id`, `created_at`, and `channel`
 * are added as a minimal envelope so the AI can always reference them.
 */
export function l2RowsToSourceDataRows(
  rows: GenuiL2Row[],
  channelSource: string,
): SourceDataRow[] {
  return rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      ...payload,
      id: row.id,
      created_at: row.created_at,
      channel: channelSource,
    } as SourceDataRow;
  });
}

// ─── unified resolver used by every /api/sources/[sourceId]/* route ────────

export type ResolvedSource =
  | {
      type: "channel";
      key: string;
      kind: string;
      name: string;
      channels: GenuiChannelRow[];
      grouping: KindGrouping | null;
      groupValue: null;
      groupField: null;
    }
  | {
      type: "group";
      key: string;
      kind: string;
      name: string;
      channels: GenuiChannelRow[];
      grouping: KindGrouping;
      groupValue: string;
      groupField: string;
    };

export async function resolveSourceKey(
  supabase: SupabaseClient,
  sourceKey: string,
): Promise<ResolvedSource | null> {
  const parsed = parseSourceKey(sourceKey);
  if (!parsed) return null;

  if (parsed.type === "channel") {
    const channel = await resolveChannelByKey(supabase, sourceKey);
    if (!channel) return null;
    const grouping = await loadKindGrouping(supabase, channel.source);
    return {
      type: "channel",
      key: sourceKey,
      kind: channel.source,
      name: channel.display_name ?? channel.external_key,
      channels: [channel],
      grouping,
      groupField: null,
      groupValue: null,
    };
  }

  // group key
  const grouping = await loadKindGrouping(supabase, parsed.kind);
  // We *can* serve a group source even when the cached grouping row was deleted
  // mid-session — we already have the field + value baked into the key.
  const channels = await listChannelsForKind(supabase, parsed.kind);
  if (channels.length === 0) return null;
  const effectiveGrouping: KindGrouping = grouping ?? {
    kind: parsed.kind,
    group_field: parsed.group_field,
    group_label: humanizeKindLabel(parsed.kind),
    timestamp_field: null,
    display_regex: null,
    confidence: "admin",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const displayName =
    parsed.group_value === GROUP_OTHER_VALUE
      ? `Other ${effectiveGrouping.group_label}`
      : formatGroupDisplay(parsed.group_value, effectiveGrouping);

  return {
    type: "group",
    key: sourceKey,
    kind: parsed.kind,
    name: displayName,
    channels,
    grouping: effectiveGrouping,
    groupField: parsed.group_field,
    groupValue: parsed.group_value,
  };
}

function humanizeKindLabel(kind: string): string {
  return kind
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Fetch the L2 rows that back a resolved source. For a channel-source returns
 * rows for that one channel; for a group-source returns the kind-scoped
 * filtered subset.
 */
export async function fetchL2RowsForSource(
  supabase: SupabaseClient,
  resolved: ResolvedSource,
): Promise<GenuiL2Row[]> {
  if (resolved.type === "channel") {
    return fetchL2RowsForChannel(supabase, resolved.channels[0]!.id);
  }
  const { rows } = await fetchL2RowsForGroup(supabase, {
    kind: resolved.kind,
    group_field: resolved.groupField,
    group_value: resolved.groupValue,
  });
  return rows;
}

// ─── tree assembly for /api/sources ────────────────────────────────────────

/**
 * Build the full sidebar tree: for each kind with visible channels, return its
 * groups (when a grouping row exists) AND its raw channels (for fallback /
 * multi-account display). Kinds with no grouping row use the flat channel
 * leaves like today.
 */
export async function buildSourceTree(supabase: SupabaseClient): Promise<{
  tree: SourceTreeNode[];
  flatSources: UiSource[];
}> {
  const [channels, groupingsByKind] = await Promise.all([
    listVisibleChannels(supabase),
    loadAllKindGroupings(supabase),
  ]);

  const byKind = new Map<string, GenuiChannelRow[]>();
  for (const c of channels) {
    const list = byKind.get(c.source) ?? [];
    list.push(c);
    byKind.set(c.source, list);
  }

  const tree: SourceTreeNode[] = [];
  for (const [kind, channelRows] of byKind.entries()) {
    const grouping = groupingsByKind.get(kind) ?? null;
    const channelLeaves = channelRows.map(channelToUiSource);
    const groups = grouping ? await listGroupsForKind(supabase, grouping) : [];
    tree.push({ kind, channels: channelLeaves, grouping, groups });
  }

  // Live kinds first, alpha tie-break — keeps a stable ordering when
  // multiple kinds are connected.
  tree.sort((a, b) => a.kind.localeCompare(b.kind));

  // Flat union (groups when present; channels otherwise) so existing consumers
  // that don't read the tree still see real Source objects.
  const flatSources: UiSource[] = [];
  for (const node of tree) {
    if (node.groups.length > 0) {
      for (const g of node.groups) {
        flatSources.push({ id: g.id, key: g.key, name: g.name, channel: g.channel });
      }
    } else {
      flatSources.push(...node.channels);
    }
  }

  return { tree, flatSources };
}

// Re-export key helpers so route files don't need a separate import.
export { GROUP_OTHER_VALUE, GROUP_KEY_SEPARATOR, formatGroupKey, parseGroupKey, isGroupKey, formatGroupDisplay };
export type { KindGrouping };
