/**
 * ingestZip — top-level orchestrator.
 *
 * Triggered by the Supabase Edge function when a zip lands in
 * `inbox/<tenant>/<chat>/<filename>.zip`.
 *
 *   1. uploadZip      → unzips, uploads bytes, inserts l0 attachments,
 *                       merges _chat.txt
 *   2. parseChat      → parses _chat.txt into l0_messages + l1_events
 *   3. extractAttachment.batchTriggerAndWait
 *                     → fans out one child task per new attachment
 *                       (audio + image + pdf + docx + xlsx + html + md + json)
 *
 * The whole graph is observable in Trigger.dev's dashboard. Children retry
 * independently; one bad voice note doesn't block the others.
 */

import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';

import { uploadZip } from './upload-zip';
import { parseChat } from './parse-chat';
import { extractAttachment } from './extract-attachment';

const IngestZipPayload = z.object({
  tenant_slug: z.string(),
  chat_slug: z.string(),
  inbox_path: z.string(),
  inbox_bucket: z.string().default('inbox'),
});

export const ingestZip = schemaTask({
  id: 'ingest-zip',
  schema: IngestZipPayload,
  retry: { maxAttempts: 1 },              // top-level — let children handle retry
  machine: { preset: 'small-1x' },
  maxDuration: 1800,                       // 30 min ceiling for whole pipeline

  run: async (payload) => {
    // ── Phase 1: upload ──
    const upRun = await uploadZip.triggerAndWait({
      tenant_slug: payload.tenant_slug,
      chat_slug: payload.chat_slug,
      inbox_path: payload.inbox_path,
      inbox_bucket: payload.inbox_bucket,
    });
    if (!upRun.ok) throw new Error(`uploadZip failed: ${JSON.stringify(upRun.error)}`);
    const { tenant_id, channel_id, counts: uploadCounts, newArtifactIds } = upRun.output;

    // ── Phase 2: parse _chat.txt ──
    const parseRun = await parseChat.triggerAndWait({
      tenant_id,
      channel_id,
      tenant_slug: payload.tenant_slug,
      chat_slug: payload.chat_slug,
    });
    if (!parseRun.ok) throw new Error(`parseChat failed: ${JSON.stringify(parseRun.error)}`);

    // ── Phases 3+4+5: fan out attachment extraction ──
    let extractionResults: Array<{ ok: boolean; output?: unknown; error?: unknown }> = [];
    if (newArtifactIds.length > 0) {
      const batch = await extractAttachment.batchTriggerAndWait(
        newArtifactIds.map((a) => ({
          payload: {
            tenant_id,
            artifact_id: a.id,
            filename: a.filename,
            mime: a.mime,
            remote_path: a.remote_path,
            channel_id: a.channel_id,
            origin_at: a.origin_at,
            actor_id: a.actor_id,
          },
        })),
      );
      extractionResults = batch.runs;
    }

    const extractionSummary = summarize(extractionResults);

    return {
      tenant_id,
      channel_id,
      upload: uploadCounts,
      parse: parseRun.output.counts,
      extraction: extractionSummary,
    };
  },
});

function summarize(runs: Array<{ ok: boolean; output?: unknown; error?: unknown }>) {
  let ok = 0, failed = 0, skipped = 0;
  const byKind: Record<string, number> = {};
  for (const r of runs) {
    if (!r.ok) {
      failed++;
      continue;
    }
    const out = r.output as { skipped?: boolean; kind?: string } | undefined;
    if (out?.skipped) {
      skipped++;
      continue;
    }
    ok++;
    if (out?.kind) byKind[out.kind] = (byKind[out.kind] ?? 0) + 1;
  }
  return { total: runs.length, ok, failed, skipped, by_kind: byKind };
}
