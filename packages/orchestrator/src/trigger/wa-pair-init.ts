/**
 * waPairInit — start a new WhatsApp device-pair attempt.
 *
 * Called from apps/web (server action) when a tenant clicks "Pair new device".
 * Creates a row in whatsapp_devices (status='pending'), asks GOWA for a fresh
 * device id + QR, returns the QR data URL for the UI to render.
 *
 * Idempotent on (tenant_id, display_name): if a pending device with the same
 * label already exists, return its current QR instead of creating a new one.
 */

import { schemaTask, tags, metadata } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { GowaClient } from '@viter-org/adapter-whatsapp-gowa';

const Payload = z.object({
  tenant_id: z.string().uuid(),
  display_name: z.string().min(1).max(100),
});

export const waPairInit = schemaTask({
  id: 'wa-pair-init',
  schema: Payload,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 1_000, maxTimeoutInMs: 5_000, randomize: true },
  queue: { concurrencyLimit: 4 },
  machine: { preset: 'small-1x' },
  maxDuration: 60,

  run: async (payload, { ctx }) => {
    await tags.add(`tenant:${payload.tenant_id}`);
    await tags.add('wa:pair-init');
    metadata.set('display_name', payload.display_name);

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const gowa = new GowaClient({
      baseUrl: process.env.GOWA_BASE_URL!,
      basicAuth: process.env.GOWA_BASIC_AUTH ?? undefined,
    });

    // 1. Idempotency: existing pending device with the same display_name?
    const { data: existing } = await supabase
      .from('whatsapp_devices')
      .select('id, gowa_device_id, status, re_pair_url')
      .eq('tenant_id', payload.tenant_id)
      .eq('display_name', payload.display_name)
      .in('status', ['pending', 'linked', 're_pair_required'])
      .maybeSingle();

    if (existing && existing.status === 'linked') {
      return { skipped: true, reason: 'already linked', device_id: existing.gowa_device_id };
    }

    if (existing && existing.re_pair_url) {
      // Re-issue same QR if still valid (GOWA may have already rotated it)
      return { resumed: true, device_id: existing.gowa_device_id, qr: existing.re_pair_url };
    }

    // 2. Ask GOWA for a new device + QR
    const created = await gowa.createDevice();

    // 3. Insert (or update existing) whatsapp_devices row
    if (existing) {
      await supabase
        .from('whatsapp_devices')
        .update({
          gowa_device_id: created.device_id,
          status: 'pending',
          re_pair_url: created.qr ?? null,
          last_error: null,
        })
        .eq('id', existing.id);
    } else {
      const { error } = await supabase.from('whatsapp_devices').insert({
        tenant_id: payload.tenant_id,
        gowa_device_id: created.device_id,
        display_name: payload.display_name,
        status: 'pending',
        re_pair_url: created.qr ?? null,
        metadata: {
          pair_initiated_by: ctx.run.id,
          pair_initiated_at: new Date().toISOString(),
        },
      });
      if (error) throw new Error(`whatsapp_devices insert: ${error.message}`);
    }

    return {
      device_id: created.device_id,
      qr: created.qr,
      expires_at: created.expires_at,
    };
  },
});
