/**
 * waKeepalive — scheduled cron that pings the GOWA service + the Supabase
 * webhook Edge Function so neither cold-starts during sparse-traffic periods.
 *
 * Runs every minute. Two signals:
 *   1. GOWA HTTP healthcheck (`GET /` returns 200) → confirms the Railway
 *      service is alive
 *   2. Supabase Edge Function ping → keeps the function "warm" so the next
 *      real webhook lands without 200-500ms cold-start tax
 *
 * Failures don't throw — they're logged. The wa-health-check task (every 5
 * min) is what alerts; this task is just a heartbeat.
 */

import { schedules, logger } from '@trigger.dev/sdk';

export const waKeepalive = schedules.task({
  id: 'wa-keepalive',
  cron: '* * * * *',                      // every minute
  maxDuration: 30,

  run: async () => {
    const gowaUrl = process.env.GOWA_BASE_URL;
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;       // the Edge Function URL

    const results: { name: string; ok: boolean; status?: number; latency_ms?: number }[] = [];

    if (gowaUrl) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${gowaUrl}/`, { method: 'HEAD' });
        results.push({ name: 'gowa', ok: res.ok, status: res.status, latency_ms: Date.now() - t0 });
      } catch (err) {
        results.push({ name: 'gowa', ok: false });
        logger.warn(`gowa keepalive failed: ${err}`);
      }
    }

    if (webhookUrl) {
      const t0 = Date.now();
      try {
        // Send a no-op POST that fails HMAC verification — Edge Function
        // returns 401 quickly which is enough to keep it warm.
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'X-Keepalive': '1', 'Content-Type': 'application/json' },
          body: '{"keepalive":true}',
        });
        results.push({ name: 'webhook', ok: true, status: res.status, latency_ms: Date.now() - t0 });
      } catch (err) {
        results.push({ name: 'webhook', ok: false });
        logger.warn(`webhook keepalive failed: ${err}`);
      }
    }

    return { pings: results, at: new Date().toISOString() };
  },
});
