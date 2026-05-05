'use server';

/**
 * Server actions for WhatsApp device management.
 *
 * v0.1 implementation: actions write directly to vita Supabase using the
 * service-role client + call GOWA's REST API. When auth lands, gate by
 * tenant membership.
 */

import { revalidatePath } from 'next/cache';
import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';
import { getGowaClient } from '@/lib/gowa';

export interface PairResult {
  ok: boolean;
  device_id?: string;
  qr?: string;
  error?: string;
}

/** Pair a new WhatsApp device. Returns QR for the UI to render. */
export async function pairNewDevice(displayName: string): Promise<PairResult> {
  if (!displayName || displayName.trim().length === 0) {
    return { ok: false, error: 'display name is required' };
  }

  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  // Check for existing pending pair attempt
  const { data: existing } = await db
    .from('whatsapp_devices')
    .select('id, gowa_device_id, status, re_pair_url')
    .eq('tenant_id', tenantId)
    .eq('display_name', displayName.trim())
    .in('status', ['pending', 're_pair_required'])
    .maybeSingle();

  if (existing && existing.re_pair_url) {
    return { ok: true, device_id: existing.gowa_device_id as string, qr: existing.re_pair_url as string };
  }

  // Ask GOWA for a fresh device
  let gowa;
  try {
    gowa = getGowaClient();
  } catch (err) {
    return { ok: false, error: `GOWA not configured: ${(err as Error).message}` };
  }

  let created;
  try {
    created = await gowa.createDevice();
  } catch (err) {
    return { ok: false, error: `GOWA createDevice failed: ${(err as Error).message}` };
  }

  // Insert/update vita-side row
  if (existing) {
    await db.from('whatsapp_devices').update({
      gowa_device_id: created.device_id,
      status: 'pending',
      re_pair_url: created.qr ?? null,
      last_error: null,
    }).eq('id', existing.id);
  } else {
    await db.from('whatsapp_devices').insert({
      tenant_id: tenantId,
      gowa_device_id: created.device_id,
      display_name: displayName.trim(),
      status: 'pending',
      re_pair_url: created.qr ?? null,
      metadata: { paired_via: 'apps/web/settings', pair_initiated_at: new Date().toISOString() },
    });
  }

  revalidatePath('/settings/whatsapp');
  return { ok: true, device_id: created.device_id, qr: created.qr };
}

/** Unlink a device from GOWA + mark it as expired in vita. */
export async function unlinkDevice(whatsappDevicesId: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data: device } = await db
    .from('whatsapp_devices')
    .select('gowa_device_id')
    .eq('id', whatsappDevicesId)
    .eq('tenant_id', tenantId)
    .single();

  if (!device) return { ok: false, error: 'device not found' };

  try {
    const gowa = getGowaClient();
    await gowa.unlinkDevice(device.gowa_device_id as string);
  } catch (err) {
    // Log but continue — local state should still update
    console.warn(`gowa unlink failed: ${(err as Error).message}`);
  }

  await db.from('whatsapp_devices').update({
    status: 'expired',
    last_error: 'unlinked by user',
  }).eq('id', whatsappDevicesId);

  revalidatePath('/settings/whatsapp');
  return { ok: true };
}

/** Refresh device statuses from GOWA's `/devices` endpoint. */
export async function refreshDeviceStatuses(): Promise<{ ok: boolean; updated: number }> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  let updated = 0;
  try {
    const gowa = getGowaClient();
    const remoteDevices = await gowa.listDevices();
    for (const r of remoteDevices) {
      const mapped = r.state === 'connected' ? 'linked' : (r.state ?? 'pending');
      const update: Record<string, unknown> = { status: mapped, last_seen_at: r.last_seen_at };
      if (r.phone_number) update.phone_number = r.phone_number;
      const { count } = await db
        .from('whatsapp_devices')
        .update(update, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('gowa_device_id', r.device_id);
      if (count) updated += count;
    }
  } catch {
    return { ok: false, updated };
  }

  revalidatePath('/settings/whatsapp');
  return { ok: true, updated };
}
