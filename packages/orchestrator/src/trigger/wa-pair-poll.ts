/**
 * waPairPoll — poll GOWA until a pending device's QR is consumed.
 *
 * Triggered immediately after waPairInit. Polls GOWA every 2 seconds for up
 * to 60s waiting for the phone to scan the QR. On consumption, flips the row
 * to 'linked' and stamps phone_number + paired_at.
 *
 * Practical reality: GOWA also fires a `pair.qr.consumed` webhook when the
 * scan happens, which the Edge Function processes. This task is the
 * belt-and-suspenders path so the apps/web UI can show "linked" without
 * waiting for webhook propagation.
 */

import { schemaTask, tags, wait } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { GowaClient } from '@viter-org/adapter-whatsapp-gowa';

const Payload = z.object({
  tenant_id: z.string().uuid(),
  device_id: z.string().min(1),         // GOWA's device_id
  whatsapp_devices_id: z.string().uuid(),
});

export const waPairPoll = schemaTask({
  id: 'wa-pair-poll',
  schema: Payload,
  retry: { maxAttempts: 1 },             // poll-style task, no retry
  queue: { concurrencyLimit: 8 },
  machine: { preset: 'small-1x' },
  maxDuration: 90,                        // 60s of polling + buffer

  run: async (payload) => {
    await tags.add(`tenant:${payload.tenant_id}`);
    await tags.add('wa:pair-poll');
    await tags.add(`device:${payload.device_id}`);

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const gowa = new GowaClient({
      baseUrl: process.env.GOWA_BASE_URL!,
      basicAuth: process.env.GOWA_BASIC_AUTH ?? undefined,
    });

    const startedAt = Date.now();
    const timeoutMs = 60_000;
    let attempts = 0;

    while (Date.now() - startedAt < timeoutMs) {
      attempts++;
      try {
        const status = await gowa.getDevice(payload.device_id);
        if (status.state === 'connected' || (status.phone_number && status.phone_number.length > 0)) {
          await supabase
            .from('whatsapp_devices')
            .update({
              status: 'linked',
              paired_at: status.paired_at ?? new Date().toISOString(),
              phone_number: status.phone_number,
              last_seen_at: status.last_seen_at ?? new Date().toISOString(),
              re_pair_url: null,
            })
            .eq('id', payload.whatsapp_devices_id);
          return { linked: true, attempts, phone_number: status.phone_number };
        }
        if (status.state === 'banned' || status.state === 'expired') {
          await supabase
            .from('whatsapp_devices')
            .update({ status: status.state, last_error: `pair-poll observed state=${status.state}` })
            .eq('id', payload.whatsapp_devices_id);
          return { linked: false, error: status.state, attempts };
        }
      } catch (err) {
        // Transient — keep polling. Log once.
        if (attempts === 1) console.warn(`[wa-pair-poll] first poll error: ${err}`);
      }
      await wait.for({ seconds: 2 });
    }

    // Timeout — leave row as 'pending'; user can retry.
    await supabase
      .from('whatsapp_devices')
      .update({ last_error: 'pair-poll timeout — QR not scanned within 60s' })
      .eq('id', payload.whatsapp_devices_id);
    return { linked: false, error: 'timeout', attempts };
  },
});
