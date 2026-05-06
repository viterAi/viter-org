/**
 * waSyncGroupNames — pulls group titles from GOWA's /chats endpoint and
 * upserts them into channels.display_name.
 *
 * Why: GOWA's webhook payload commonly omits `group_subject`, so groups
 * land in the DB with placeholder names (the first speaker's pushName,
 * or just the slug). The /chats endpoint returns the real group titles
 * — we periodically reconcile.
 *
 * Triggered:
 *   - cron daily at 03:00 UTC (idempotent)
 *   - manually via the trigger.dev dashboard for an immediate sync
 *
 * Update rule:
 *   - Only writes when the new title differs from what's stored.
 *   - Never overwrites a manually-set display_name that matches the live
 *     group subject (idempotent — diff check).
 *   - Skips channels whose identifier doesn't start with `wa-group-` (1:1s).
 */

import { schedules, metadata, logger } from '@trigger.dev/sdk';
import { createClient } from '@supabase/supabase-js';
import { GowaClient } from '@vita/adapter-whatsapp-gowa';

interface ChatRow {
  chat_id: string;
  is_group: boolean;
  name: string | null;
}

/**
 * GOWA's /chats response shape varies across versions; we accept the
 * superset and pluck out (chat_id, name, is_group) defensively.
 *
 * Observed shapes:
 *   - { code: 'SUCCESS', results: [{ jid, name, is_group }] }
 *   - [{ jid, name }]
 *   - { results: { chats: [...] } }
 */
function normalizeChats(raw: unknown): ChatRow[] {
  const candidates: unknown[] = [];
  if (Array.isArray(raw)) candidates.push(...raw);
  else if (raw && typeof raw === 'object') {
    const r = raw as { results?: unknown; data?: unknown; chats?: unknown };
    const inner = r.results ?? r.data ?? r.chats;
    if (Array.isArray(inner)) candidates.push(...inner);
    else if (inner && typeof inner === 'object') {
      const i = inner as { chats?: unknown };
      if (Array.isArray(i.chats)) candidates.push(...i.chats);
    }
  }

  const out: ChatRow[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const chatId = (o.chat_id ?? o.jid ?? o.id ?? o.JID) as string | undefined;
    if (!chatId || typeof chatId !== 'string') continue;
    const isGroup = chatId.endsWith('@g.us')
      || o.is_group === true
      || o.IsGroup === true;
    const name = (o.name ?? o.group_subject ?? o.subject ?? o.Name ?? null) as string | null;
    out.push({ chat_id: chatId, is_group: !!isGroup, name: typeof name === 'string' && name.length ? name : null });
  }
  return out;
}

function chatIdToSlug(chatId: string): string {
  const isGroup = chatId.endsWith('@g.us');
  const local = chatId.replace(/@.*$/, '');
  return isGroup ? `wa-group-${local}` : `wa-${local}`;
}

export const waSyncGroupNames = schedules.task({
  id: 'wa-sync-group-names',
  cron: '0 3 * * *',
  maxDuration: 120,

  run: async () => {
    const baseUrl = process.env.GOWA_BASE_URL;
    const basicAuth = process.env.GOWA_BASIC_AUTH;
    if (!baseUrl) {
      logger.warn('GOWA_BASE_URL not set — skipping');
      return { skipped: true };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const gowa = new GowaClient({ baseUrl, basicAuth });

    const { data: devices, error: devErr } = await supabase
      .from('whatsapp_devices')
      .select('id, tenant_id, gowa_device_id, status')
      .eq('status', 'connected');
    if (devErr) throw new Error(`devices: ${devErr.message}`);

    metadata.set('devices', devices?.length ?? 0);

    let scanned = 0;
    let updated = 0;
    let skipped_unchanged = 0;
    const errors: string[] = [];

    for (const dev of devices ?? []) {
      let raw: unknown;
      try {
        raw = await gowa.listChats(dev.gowa_device_id);
      } catch (err) {
        errors.push(`${dev.gowa_device_id}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      const chats = normalizeChats(raw);
      const groups = chats.filter((c) => c.is_group && c.name);
      scanned += groups.length;

      for (const g of groups) {
        const slug = chatIdToSlug(g.chat_id);
        const desired = `WhatsApp · ${g.name!}`;

        const { data: existing } = await supabase
          .from('channels')
          .select('id, display_name')
          .eq('tenant_id', dev.tenant_id)
          .eq('kind', 'whatsapp')
          .eq('identifier', slug)
          .maybeSingle();

        if (!existing) continue; // channel is created by webhook on first message; we don't seed
        if (existing.display_name === desired) {
          skipped_unchanged++;
          continue;
        }

        const { error: upErr } = await supabase
          .from('channels')
          .update({ display_name: desired })
          .eq('id', existing.id);
        if (upErr) {
          errors.push(`update ${slug}: ${upErr.message}`);
          continue;
        }
        updated++;
      }
    }

    metadata.set('scanned', scanned).set('updated', updated).set('skipped_unchanged', skipped_unchanged);
    if (errors.length) metadata.set('errors', errors);

    return { scanned, updated, skipped_unchanged, errors: errors.slice(0, 5) };
  },
});
