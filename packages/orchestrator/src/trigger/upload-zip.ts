/**
 * uploadZip — phase 1 in the cloud.
 *
 * Reads a zip from `inbox/<chat>/<filename>.zip`, unzips inside the container,
 * uploads each file to `l0-whatsapp/<tenant>/<chat>/<filename>` (deduped),
 * inserts l0_artifacts(whatsapp_attachment) for each non-_chat.txt file,
 * and merges _chat.txt with whatever was there before.
 *
 * Returns the list of new artifact ids (for the orchestrator to fan out
 * extraction over).
 */

import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import StreamZip from 'node-stream-zip';

const UploadZipPayload = z.object({
  tenant_slug: z.string(),
  chat_slug: z.string(),
  inbox_path: z.string(),                 // e.g. "viter/shaul-direct/2026-05-04T223400Z.zip"
  inbox_bucket: z.string().default('inbox'),
});

export const uploadZip = schemaTask({
  id: 'upload-zip',
  schema: UploadZipPayload,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000 },
  // Streaming download + per-entry zip iteration → peak RAM is one file at a
  // time (typically <5 MB), independent of zip size. small-2x = 1 GB is comfy.
  machine: { preset: 'small-2x' },
  maxDuration: 600,                        // 10 min — generous for big zips

  run: async (payload) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Resolve tenant + channel
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', payload.tenant_slug)
      .single();
    if (!tenant) throw new Error(`tenant '${payload.tenant_slug}' not found`);
    const tenantId = tenant.id as string;

    const { data: channel } = await supabase
      .from('channels')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kind', 'whatsapp')
      .eq('identifier', payload.chat_slug)
      .single();
    if (!channel) throw new Error(`channel 'whatsapp:${payload.chat_slug}' not found`);
    const channelId = channel.id as string;

    // 1. Stream the zip from Supabase Storage to /tmp without ever holding it
    //    in memory. blob.stream() returns a Web ReadableStream; convert to
    //    Node Readable and pipe to disk.
    const tmpDir = mkdtempSync(join(tmpdir(), 'vita-zip-'));
    const zipPath = join(tmpDir, 'in.zip');

    const { data: zipBlob, error: zipErr } = await supabase.storage
      .from(payload.inbox_bucket)
      .download(payload.inbox_path);
    if (zipErr || !zipBlob) throw new Error(`zip download: ${zipErr?.message}`);

    const webStream = (zipBlob as Blob).stream() as ReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(webStream as never), createWriteStream(zipPath));

    // 2. Open zip and iterate entries. Reads only the central directory at
    //    open time (~tens of KB), then streams one entry buffer at a time.
    const zip = new StreamZip.async({ file: zipPath });
    const entriesMap = await zip.entries();
    const fileEntries = Object.values(entriesMap).filter((e) => !e.isDirectory);

    let nUploaded = 0;
    let nSkippedDup = 0;
    let nL0Inserted = 0;
    let nL0Existing = 0;
    let nErrors = 0;
    const newArtifactIds: Array<{
      id: string; filename: string; mime: string; remote_path: string; origin_at: string; channel_id: string; actor_id: null;
    }> = [];

    for (const entry of fileEntries) {
      const filename = entry.name;
      // node-stream-zip extracts one entry into a Buffer — bounded by single-file size.
      const buf: Buffer = await zip.entryData(entry.name);
      const mime = inferMimeType(filename);
      const isChat = filename === '_chat.txt';
      const remotePath = `${payload.tenant_slug}/${payload.chat_slug}/${filename}`;

      if (isChat) {
        // Merge with existing _chat.txt if any (UNION of message blocks)
        const { data: existing } = await supabase.storage
          .from('l0-whatsapp')
          .download(remotePath);
        let bytesToUpload = buf;
        let action = 'first-upload';
        if (existing) {
          const existingText = await existing.text();
          const incomingText = buf.toString('utf-8');
          const merged = mergeChatTxt(existingText, incomingText);
          if (merged.length === existingText.length) {
            nSkippedDup++;
            continue;
          }
          bytesToUpload = Buffer.from(merged, 'utf-8');
          action = 'merge';
        }
        const { error: upErr } = await supabase.storage
          .from('l0-whatsapp')
          .upload(remotePath, bytesToUpload, {
            contentType: mime,
            upsert: true,
          });
        if (upErr) {
          nErrors++;
          continue;
        }
        nUploaded++;
        continue;
      }

      // Attachment: upsert=false, treat duplicate as success
      const sha = createHash('sha256').update(buf).digest('hex');
      const { error: upErr } = await supabase.storage
        .from('l0-whatsapp')
        .upload(remotePath, buf, { contentType: mime, upsert: false });
      if (upErr) {
        const m = upErr.message?.toLowerCase() ?? '';
        if (m.includes('exists') || m.includes('duplicate')) nSkippedDup++;
        else { nErrors++; continue; }
      } else {
        nUploaded++;
      }

      // l0_artifact insert (sha-deduped)
      const { data: existingArt } = await supabase
        .from('l0_artifacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sha256', sha)
        .maybeSingle();
      if (existingArt) {
        nL0Existing++;
        continue;
      }

      // node-stream-zip exposes the entry's mtime in `entry.time` (ms since epoch).
      const entryMtime = entry.time ? new Date(entry.time) : new Date();
      const originAt = parseOriginAtFromFilename(filename) ?? entryMtime.toISOString();
      const kind = inferKind(mime);

      const { data: ins, error: insErr } = await supabase
        .from('l0_artifacts')
        .insert({
          tenant_id: tenantId,
          source_type: 'whatsapp_attachment',
          source_uri: `l0-whatsapp/${remotePath}`,
          sha256: sha,
          bytes: buf.length,
          origin_at: originAt,
          storage_url: `l0-whatsapp/${remotePath}`,
          metadata: {
            chat_slug: payload.chat_slug,
            tenant_slug: payload.tenant_slug,
            filename,
            mime_type: mime,
            msg_counter: filename.match(/^(\d{8})-/)?.[1] ?? null,
            kind,
          },
        })
        .select('id')
        .single();
      if (insErr || !ins) {
        nErrors++;
        continue;
      }
      nL0Inserted++;
      newArtifactIds.push({
        id: ins.id as string,
        filename,
        mime,
        remote_path: remotePath,
        origin_at: originAt,
        channel_id: channelId,
        actor_id: null,
      });
    }

    await zip.close();
    rmSync(tmpDir, { recursive: true, force: true });

    return {
      tenant_id: tenantId,
      channel_id: channelId,
      counts: { nUploaded, nSkippedDup, nL0Inserted, nL0Existing, nErrors, files: fileEntries.length },
      newArtifactIds,
    };
  },
});

// ── helpers (mirror scripts/whatsapp-phase1-upload.ts) ──

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.opus')) return 'audio/ogg; codecs=opus';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function inferKind(mime: string): string {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('officedocument')) return 'office';
  if (mime === 'application/zip') return 'zip';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'other';
}

function parseOriginAtFromFilename(filename: string): string | null {
  const m = filename.match(/-(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2})\./);
  if (!m) return null;
  return `${m[1]}T${m[2]!.replace(/-/g, ':')}+03:00`;
}

function mergeChatTxt(existing: string, incoming: string): string {
  const HEADER = /^‎?\[\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\]\s+/;

  function splitMessages(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const msgs: string[] = [];
    let cur: string[] = [];
    for (const ln of lines) {
      if (HEADER.test(ln)) {
        if (cur.length) msgs.push(cur.join('\n'));
        cur = [ln];
      } else if (cur.length) {
        cur.push(ln);
      }
    }
    if (cur.length) msgs.push(cur.join('\n'));
    return msgs;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of splitMessages(existing)) {
    const h = createHash('sha256').update(m).digest('hex');
    if (!seen.has(h)) { seen.add(h); out.push(m); }
  }
  for (const m of splitMessages(incoming)) {
    const h = createHash('sha256').update(m).digest('hex');
    if (!seen.has(h)) { seen.add(h); out.push(m); }
  }
  return out.join('\n') + '\n';
}
