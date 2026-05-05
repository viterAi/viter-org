/**
 * Principal alias resolver.
 *
 * Maps strings observed in the wild (WhatsApp push_name, GitHub commit
 * author, email From, meeting transcript renderings) to a canonical
 * principal_id by matching against `principals.identifiers` (jsonb array).
 *
 * Why this exists: the per-person zoom-in surfaced that one human can have
 * 4+ different name spellings across systems (Yitzchak / Yitchak Shaul Levin
 * / Issac Brown / Epikaai / yy@upvlu.com). Without alias resolution, every
 * message from that person has actor_id=null — losing a key dimension for
 * downstream L2/L3 fusion.
 *
 * The resolver does:
 *   1. Exact match against any string in identifiers[]
 *   2. Case-insensitive match
 *   3. (Optional) substring containment for two-word names
 *
 * It does NOT do fuzzy / Levenshtein matching — that's risky for false
 * positives. If a name doesn't match any alias, return null and log it so
 * an operator can extend identifiers[] for that principal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PrincipalAliasMatch {
  principal_id: string;
  canonical_id: string;
  display_name: string;
  matched_alias: string;
  match_type: 'exact' | 'case_insensitive' | 'contains';
}

/**
 * Cache: tenant_id → array of {principal, identifiers[]}
 * Loaded lazily on first lookup; refreshed every 5 minutes.
 */
interface CachedPrincipal {
  id: string;
  canonical_id: string;
  display_name: string;
  identifiers: string[];
  identifiers_lc: string[];
}
const CACHE = new Map<string, { at: number; principals: CachedPrincipal[] }>();
const CACHE_TTL_MS = 5 * 60_000;

async function loadPrincipals(db: SupabaseClient, tenantId: string): Promise<CachedPrincipal[]> {
  const cached = CACHE.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.principals;

  const { data, error } = await db
    .from('principals')
    .select('id, canonical_id, display_name, identifiers')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`alias-resolver: ${error.message}`);

  const principals: CachedPrincipal[] = (data ?? []).map((p) => {
    const idsRaw = (p.identifiers ?? []) as unknown[];
    const ids = Array.isArray(idsRaw)
      ? idsRaw.filter((s): s is string => typeof s === 'string')
      : [];
    return {
      id: p.id as string,
      canonical_id: p.canonical_id as string,
      display_name: p.display_name as string,
      identifiers: ids,
      identifiers_lc: ids.map((s) => s.toLowerCase()),
    };
  });

  CACHE.set(tenantId, { at: Date.now(), principals });
  return principals;
}

export async function resolveAlias(
  db: SupabaseClient,
  args: { tenantId: string; raw: string | null | undefined; allowContains?: boolean },
): Promise<PrincipalAliasMatch | null> {
  const raw = (args.raw ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const principals = await loadPrincipals(db, args.tenantId);

  // 1. Exact match
  for (const p of principals) {
    if (p.identifiers.includes(raw) || p.canonical_id === raw || p.display_name === raw) {
      return { principal_id: p.id, canonical_id: p.canonical_id, display_name: p.display_name, matched_alias: raw, match_type: 'exact' };
    }
  }

  // 2. Case-insensitive
  for (const p of principals) {
    if (p.identifiers_lc.includes(lower)
        || p.canonical_id.toLowerCase() === lower
        || p.display_name.toLowerCase() === lower) {
      const matched = p.identifiers.find((s) => s.toLowerCase() === lower) ?? p.canonical_id;
      return { principal_id: p.id, canonical_id: p.canonical_id, display_name: p.display_name, matched_alias: matched, match_type: 'case_insensitive' };
    }
  }

  // 3. Containment (only if explicitly opted in — false positives possible)
  if (args.allowContains) {
    for (const p of principals) {
      const hit = p.identifiers_lc.find((alias) =>
        alias.length >= 4 && (lower.includes(alias) || alias.includes(lower))
      );
      if (hit) {
        return { principal_id: p.id, canonical_id: p.canonical_id, display_name: p.display_name, matched_alias: hit, match_type: 'contains' };
      }
    }
  }

  return null;
}

/** Force-refresh the cache for a tenant — useful after bulk identifier updates. */
export function invalidateAliasCache(tenantId?: string): void {
  if (tenantId) CACHE.delete(tenantId);
  else CACHE.clear();
}
