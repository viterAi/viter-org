/**
 * Cached principal + channel resolution. Backed by Supabase queries; in-memory cache
 * per Runner instance avoids re-querying the same canonical_id over and over.
 *
 * Channels are auto-upserted on miss. Principals are NOT — unknown actors return null
 * (the runner logs them so a human can decide whether to add a principal row).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from './types.js';

export class CachedResolver {
  private actorCache = new Map<string, UUID | null>();
  private channelCache = new Map<string, UUID | null>();

  constructor(
    private readonly db: SupabaseClient,
    private readonly tenantId: UUID,
  ) {}

  async resolveActor(canonicalId: string): Promise<UUID | null> {
    if (this.actorCache.has(canonicalId)) {
      return this.actorCache.get(canonicalId) ?? null;
    }
    const { data, error } = await this.db
      .from('principals')
      .select('id')
      .eq('tenant_id', this.tenantId)
      .eq('canonical_id', canonicalId)
      .maybeSingle();

    if (error) throw new Error(`resolveActor(${canonicalId}): ${error.message}`);
    const id = (data?.id as UUID | undefined) ?? null;
    this.actorCache.set(canonicalId, id);
    return id;
  }

  async resolveChannel(kind: string, identifier: string): Promise<UUID | null> {
    const k = `${kind}:${identifier}`;
    if (this.channelCache.has(k)) {
      return this.channelCache.get(k) ?? null;
    }
    const { data, error } = await this.db
      .from('channels')
      .select('id')
      .eq('tenant_id', this.tenantId)
      .eq('kind', kind)
      .eq('identifier', identifier)
      .maybeSingle();

    if (error) throw new Error(`resolveChannel(${kind}:${identifier}): ${error.message}`);
    const id = (data?.id as UUID | undefined) ?? null;
    this.channelCache.set(k, id);
    return id;
  }

  async upsertChannel(kind: string, identifier: string, displayName?: string): Promise<UUID> {
    const existing = await this.resolveChannel(kind, identifier);
    if (existing) return existing;

    const insertRow: Record<string, unknown> = {
      tenant_id: this.tenantId,
      kind,
      identifier,
    };
    if (displayName !== undefined) insertRow.display_name = displayName;

    const { data, error } = await this.db
      .from('channels')
      .insert(insertRow)
      .select('id')
      .single();

    if (error) throw new Error(`upsertChannel(${kind}:${identifier}): ${error.message}`);
    const id = data.id as UUID;
    this.channelCache.set(`${kind}:${identifier}`, id);
    return id;
  }
}
