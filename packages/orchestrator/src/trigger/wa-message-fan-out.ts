/**
 * waMessageFanOut — scheduled task that picks up media-bearing live WhatsApp
 * messages from l0_artifacts and dispatches extract-attachment for each.
 *
 * The whatsapp-webhook Edge Function does not call trigger.dev directly —
 * that would require a Trigger SDK call from Deno EF (rate-limited, brittle).
 * Instead, the EF inserts the l0_artifact with the media URL in metadata and
 * this task picks them up. Runs every 30 seconds for low-latency processing.
 *
 * Flow:
 *   1. Find l0_artifacts where source_type='whatsapp_message_live'
 *      AND metadata.media is not null
 *      AND no l1_extraction_run exists yet
 *   2. For each: trigger extract-attachment with the media URL
 *   3. extract-attachment downloads the media (via GOWA media URL),
 *      runs the dispatcher (audio→Whisper, image→Gemini, doc→Gemini-PDF),
 *      writes l1_event
 */

import { schedules, tasks, tags, metadata, logger } from '@trigger.dev/sdk';
import { createClient } from '@supabase/supabase-js';

export const waMessageFanOut = schedules.task({
  id: 'wa-message-fan-out',
  cron: '*/1 * * * *',                       // every minute (Trigger's min granularity)
  maxDuration: 120,

  run: async () => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Find media artifacts from the last hour that haven't been extracted yet.
    // We bound the lookback to keep the query fast; older un-extracted media
    // is handled by the wa-backfill task (manual trigger).
    const sinceIso = new Date(Date.now() - 3_600_000).toISOString();

    const { data: pending, error } = await supabase
      .from('l0_artifacts')
      .select('id, tenant_id, source_uri, metadata, origin_at')
      .eq('source_type', 'whatsapp_message_live')
      .gte('captured_at', sinceIso)
      .not('metadata->media', 'is', null)
      .order('captured_at', { ascending: true })
      .limit(50);

    if (error) {
      logger.error(`fan-out query: ${error.message}`);
      throw new Error(error.message);
    }
    if (!pending || pending.length === 0) {
      return { dispatched: 0, scanned: 0 };
    }

    // Filter out already-extracted ones in a single follow-up query
    const ids = pending.map((a) => a.id);
    const { data: extracted } = await supabase
      .from('l1_extraction_runs')
      .select('artifact_id')
      .in('artifact_id', ids)
      .eq('status', 'ok');
    const done = new Set((extracted ?? []).map((e) => e.artifact_id as string));

    const todo = pending.filter((a) => !done.has(a.id));
    metadata.set('scanned', pending.length).set('todo', todo.length);

    let dispatched = 0;
    for (const art of todo) {
      const meta = art.metadata as Record<string, unknown>;
      const media = meta.media as { url?: string; mime_type?: string; filename?: string } | null;
      if (!media?.url) continue;

      try {
        await tasks.trigger('extract-attachment', {
          tenant_id: art.tenant_id,
          artifact_id: art.id,
          filename: media.filename ?? `wa-${art.id}.bin`,
          mime: media.mime_type ?? 'application/octet-stream',
          remote_path: media.url,                            // GOWA media URL
          channel_id: null,                                  // resolved by the task
          origin_at: art.origin_at,
          actor_id: null,
        });
        await tags.add(`wa:fanout:${art.id}`);
        dispatched++;
      } catch (err) {
        logger.warn(`fan-out trigger failed for ${art.id}: ${err}`);
      }
    }

    return { dispatched, scanned: pending.length, todo: todo.length };
  },
});
