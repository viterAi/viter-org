/**
 * parseChat — phase 2 in the cloud.
 *
 * Reads the (already-merged) `_chat.txt` from the bucket, splits into messages,
 * resolves senders → principals, links attachments → existing l0_artifact ids,
 * and writes l0_artifacts(whatsapp_message) + l1_extraction_runs + l1_events.
 *
 * Idempotent — sha256(ts_raw|sender|body) keys each message.
 */

import { createHash } from 'node:crypto';

import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const ParseChatPayload = z.object({
  tenant_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  tenant_slug: z.string(),
  chat_slug: z.string(),
});

const HEADER_RE =
  /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\]\s+([^:]+?):\s?(.*)$/;
const ATTACHED_RE = /‎?<attached:\s*([^>]+)>/g;
const ENCRYPTION_NOTICE = 'Messages and calls are end-to-end encrypted';

interface ParsedMessage {
  ts_raw: string;
  ts_iso: string;
  sender_raw: string;
  body: string;
  attachments: string[];
  line_no: number;
}

export const parseChat = schemaTask({
  id: 'parse-chat',
  schema: ParseChatPayload,
  retry: { maxAttempts: 2 },
  machine: { preset: 'small-1x' },
  maxDuration: 300,

  run: async (payload) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const remotePath = `${payload.tenant_slug}/${payload.chat_slug}/_chat.txt`;
    const { data: blob, error: dErr } = await supabase.storage
      .from('l0-whatsapp')
      .download(remotePath);
    if (dErr || !blob) throw new Error(`download _chat.txt: ${dErr?.message}`);
    const text = await blob.text();

    const messages = parseChatTxt(text);

    // Sender → principal_id map
    const { data: principals } = await supabase
      .from('principals')
      .select('id, canonical_id, display_name')
      .eq('tenant_id', payload.tenant_id);
    const senderToPrincipal = new Map<string, string>();
    for (const p of principals ?? []) {
      const dn = (p.display_name as string).toLowerCase();
      const cid = (p.canonical_id as string).toLowerCase();
      const first = dn.split(/\s+/)[0]!;
      senderToPrincipal.set(dn, p.id as string);
      senderToPrincipal.set(cid, p.id as string);
      if (!senderToPrincipal.has(first)) senderToPrincipal.set(first, p.id as string);
    }
    const resolveSender = (raw: string): string | null => {
      const lower = raw.toLowerCase().trim();
      return senderToPrincipal.get(lower)
        ?? senderToPrincipal.get(lower.split(/\s+/)[0]!)
        ?? null;
    };

    // Filename → attachment artifact_id map
    const { data: attachmentRows } = await supabase
      .from('l0_artifacts')
      .select('id, metadata')
      .eq('tenant_id', payload.tenant_id)
      .eq('source_type', 'whatsapp_attachment')
      .eq('metadata->>chat_slug', payload.chat_slug);
    const filenameToArtifactId = new Map<string, string>();
    for (const r of attachmentRows ?? []) {
      const fn = (r.metadata as { filename?: string })?.filename;
      if (fn) filenameToArtifactId.set(fn, r.id as string);
    }

    // Hash each message and skip already-stored ones
    const decorated = messages.map((m) => ({
      ...m,
      hash: createHash('sha256').update(`${m.ts_raw}|${m.sender_raw}|${m.body}`).digest('hex'),
    }));
    const allHashes = decorated.map((m) => m.hash);
    const existing = new Set<string>();
    for (let i = 0; i < allHashes.length; i += 200) {
      const { data } = await supabase
        .from('l0_artifacts')
        .select('sha256')
        .eq('tenant_id', payload.tenant_id)
        .in('sha256', allHashes.slice(i, i + 200));
      for (const row of data ?? []) existing.add(row.sha256 as string);
    }

    let nL0 = 0, nRuns = 0, nEvents = 0, nErrors = 0;

    for (const m of decorated) {
      if (existing.has(m.hash)) continue;

      const actorId = resolveSender(m.sender_raw);
      const kind = classifyKind(m.body, m.attachments);
      const modality = deriveModality(m.attachments, m.body);
      const sourceUri = `l0-whatsapp/${remotePath}#L${m.line_no}`;

      const { data: l0Ins, error: l0Err } = await supabase
        .from('l0_artifacts')
        .insert({
          tenant_id: payload.tenant_id,
          source_type: 'whatsapp_message',
          source_uri: sourceUri,
          sha256: m.hash,
          bytes: Buffer.byteLength(m.body, 'utf8'),
          origin_at: m.ts_iso,
          inline_text: m.body,
          metadata: {
            chat_slug: payload.chat_slug,
            tenant_slug: payload.tenant_slug,
            sender_raw: m.sender_raw,
            ts_raw: m.ts_raw,
            line_no: m.line_no,
            kind,
            attachment_filenames: m.attachments,
          },
        })
        .select('id')
        .single();
      if (l0Err || !l0Ins) { nErrors++; continue; }
      const artifactId = l0Ins.id as string;
      nL0++;

      const { data: runIns, error: runErr } = await supabase
        .from('l1_extraction_runs')
        .insert({
          tenant_id: payload.tenant_id,
          artifact_id: artifactId,
          facet: 'messages',
          extractor: 'whatsapp-text-parser',
          version: 'v1',
          parameters: {},
          is_deterministic: true,
          status: 'ok',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          metrics: { n_events: 1 },
        })
        .select('id')
        .single();
      if (runErr || !runIns) { nErrors++; continue; }
      const runId = runIns.id as string;
      nRuns++;

      const attachmentArtifactIds = m.attachments
        .map((fn) => filenameToArtifactId.get(fn))
        .filter((x): x is string => Boolean(x));

      const { error: evErr } = await supabase.from('l1_events').insert({
        tenant_id: payload.tenant_id,
        artifact_id: artifactId,
        extraction_run_id: runId,
        facet: 'messages',
        event_at: m.ts_iso,
        position: 0,
        actor_id: actorId,
        channel_id: payload.channel_id,
        modality,
        content: m.body,
        line_no: m.line_no,
        confidence: 1.0,
        extraction_method: 'whatsapp-text-parser@v1',
        metadata: {
          sender_raw: m.sender_raw,
          kind,
          attachment_filenames: m.attachments,
          attachment_artifact_ids: attachmentArtifactIds,
          unresolved_attachments: m.attachments.length - attachmentArtifactIds.length,
        },
      });
      if (evErr) { nErrors++; continue; }
      nEvents++;
    }

    return {
      counts: {
        parsed: decorated.length,
        existing: existing.size,
        new_l0: nL0,
        new_runs: nRuns,
        new_events: nEvents,
        errors: nErrors,
      },
    };
  },
});

function parseChatTxt(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const m = HEADER_RE.exec(raw);
    if (m) {
      if (current) messages.push(current);
      const [, dd, mm, yyyy, hh, mi, ss, sender, body] = m;
      if (body!.includes(ENCRYPTION_NOTICE)) {
        current = null;
        continue;
      }
      const ts_raw = `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`;
      const ts_iso = `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}T${hh!.padStart(2, '0')}:${mi}:${ss}+03:00`;
      const attachments = [...body!.matchAll(ATTACHED_RE)].map((mm2) => mm2[1]!.trim());
      current = { ts_raw, ts_iso, sender_raw: sender!.trim(), body: body!.trim(), attachments, line_no: i + 1 };
    } else if (current && raw.trim()) {
      current.body = current.body + '\n' + raw;
      current.attachments = [...current.body.matchAll(ATTACHED_RE)].map((mm2) => mm2[1]!.trim());
    }
  }
  if (current) messages.push(current);
  return messages;
}

function deriveModality(attachments: string[], body: string): string {
  if (attachments.length === 0) {
    if (/voice call|missed.*call|this message was deleted/i.test(body)) return 'signal';
    return 'text';
  }
  const a0 = attachments[0]!.toLowerCase();
  if (/\.(opus|m4a|mp3|wav)$/.test(a0)) return 'voice';
  if (/\.(jpe?g|png|webp|gif)$/.test(a0)) return 'image';
  if (/\.(mp4|mov)$/.test(a0)) return 'video';
  if (/\.(pdf|docx?|xlsx?|zip|json|html)$/.test(a0)) return 'file';
  return 'file';
}

function classifyKind(body: string, attachments: string[]): string {
  if (attachments.length > 0) return 'attachment';
  if (/^‎?Missed voice call/i.test(body) || /Voice call/i.test(body)) return 'call_event';
  if (/^‎?This message was deleted/i.test(body)) return 'deleted';
  return 'text';
}
