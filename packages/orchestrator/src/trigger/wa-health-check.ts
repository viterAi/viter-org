/**
 * waHealthCheck — scheduled cron that surfaces unhealthy WhatsApp devices.
 *
 * Runs every 5 minutes. Reads the `whatsapp_device_health` view, identifies
 * devices needing attention (re_pair_required, disconnected > 5 min, banned,
 * expired, or expires_at within 3 days). Tags the run + writes an alert
 * record per unhealthy device.
 *
 * Alert delivery is left to the orchestrator's notification layer (out of
 * scope for v0.1) — but the data is queryable via:
 *   select * from public.whatsapp_devices_needing_attention;
 */

import { schedules, tags, metadata, logger } from '@trigger.dev/sdk';
import { createClient } from '@supabase/supabase-js';

export const waHealthCheck = schedules.task({
  id: 'wa-health-check',
  cron: '*/5 * * * *',                        // every 5 minutes
  maxDuration: 30,

  run: async () => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await supabase
      .from('whatsapp_devices_needing_attention')
      .select('id, tenant_id, gowa_device_id, phone_number, display_name, status, health_score, last_seen_at, days_until_re_pair, last_error');

    if (error) {
      logger.error(`health-check query failed: ${error.message}`);
      throw new Error(error.message);
    }

    const unhealthy = data ?? [];
    metadata.set('unhealthy_count', unhealthy.length);

    if (unhealthy.length === 0) {
      return { ok: true, healthy: true, count: 0 };
    }

    // Tag the run for filtering in the trigger.dev UI
    await tags.add('wa:health-alert');
    await tags.add(`wa:unhealthy:${unhealthy.length}`);
    for (const d of unhealthy.slice(0, 5)) {
      await tags.add(`wa:device:${d.gowa_device_id}`);
    }

    // Surface in run metadata so it's visible without leaving the dashboard
    metadata.set('unhealthy_devices', unhealthy.map(d => ({
      device_id: d.gowa_device_id,
      tenant_id: d.tenant_id,
      status: d.status,
      health: d.health_score,
      last_seen: d.last_seen_at,
      days_until_re_pair: d.days_until_re_pair,
      error: d.last_error,
    })));

    return {
      ok: true,
      healthy: false,
      count: unhealthy.length,
      sample: unhealthy.slice(0, 3),
    };
  },
});
