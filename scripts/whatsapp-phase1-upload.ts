/**
 * scripts/whatsapp-phase1-upload.ts
 *
 * Phase 1 of WhatsApp ingest — bytes only, no parsing yet.
 *
 * Steps:
 *   1. Unzip a "WhatsApp Chat - <name>.zip" (locally, in /tmp)
 *   2. Upload _chat.txt + every attachment to Supabase Storage
 *      bucket: l0-whatsapp/<tenant-slug>/<chat-slug>/<filename>
 *   3. Insert l0_artifacts(source_type='whatsapp_attachment') per file (sha-deduped)
 *      Skip _chat.txt — it's not an L0 row in our model, just bytes for re-processing
 *   4. Print summary
 *
 * Usage:
 *   tsx scripts/whatsapp-phase1-upload.ts <zip-path> --tenant viter --chat shaul-direct
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent. Re-run as many times as you want — sha256 dedup blocks duplicate inserts;
 * filename-based bucket upload with `upsert: false` skips existing files.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat, mkdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { createServiceRoleClient } from '../packages/runtime/src/db.js';

interface Args {
  zipPath: string;
  tenant: string;
  chat: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') out.tenant = argv[++i];
    else if (a === '--chat') out.chat = argv[++i];
    else if (a !== undefined && !out.zipPath) out.zipPath = a;
  }
  if (!out.zipPath || !out.tenant || !out.chat) {
    console.error('Usage: tsx scripts/whatsapp-phase1-upload.ts <zip-path> --tenant <slug> --chat <slug>');
    process.exit(2);
  }
  return out as Args;
}

function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Merge two _chat.txt exports.
 *
 * Each header line `[DD/MM/YYYY, HH:MM:SS] Sender: ...` plus its continuation
 * lines forms one logical message. We dedupe whole messages by sha256(header+body),
 * preserving the first export's order and appending only messages new to the second.
 *
 * The second export may be a strict subset, a strict superset, or overlap — output
 * is the UNION, never shrinking what was previously stored.
 */
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
  let added = 0;
  for (const m of splitMessages(incoming)) {
    const h = createHash('sha256').update(m).digest('hex');
    if (!seen.has(h)) { seen.add(h); out.push(m); added++; }
  }
  if (added > 0) console.log(`  ↻ _chat.txt merge: +${added} new messages`);
  return out.join('\n') + '\n';
}

/**
 * Parse origin_at from WhatsApp's stable filename pattern:
 *   00000002-AUDIO-2026-02-25-23-26-02.opus
 *   00000005-PHOTO-2026-02-26-00-05-45.jpg
 *   00000190-GIF-2026-03-24-20-24-51.mp4
 *   00000431-STICKER-2026-04-21-10-47-01.webp
 * For non-matching names (PDFs, DOCXs with custom names): null.
 */
function parseOriginAtFromFilename(filename: string): string | null {
  const m = filename.match(/-(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2})\./);
  if (!m) return null;
  // Reconstruct to ISO: YYYY-MM-DDTHH:MM:SS+03:00 (Israel timezone — WA exports use device local time)
  return `${m[1]}T${m[2]!.replace(/-/g, ':')}+03:00`;
}

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

async function main() {
  const args = parseArgs(process.argv);
  const db = createServiceRoleClient();

  // Resolve tenant_id
  const { data: tenantRow, error: tErr } = await db
    .from('tenants')
    .select('id, slug')
    .eq('slug', args.tenant)
    .single();
  if (tErr || !tenantRow) {
    throw new Error(`tenant '${args.tenant}' not found: ${tErr?.message}`);
  }
  const tenantId = tenantRow.id as string;

  // Resolve channel
  const { data: channelRow, error: cErr } = await db
    .from('channels')
    .select('id, kind, identifier')
    .eq('tenant_id', tenantId)
    .eq('kind', 'whatsapp')
    .eq('identifier', args.chat)
    .single();
  if (cErr || !channelRow) {
    throw new Error(`channel 'whatsapp:${args.chat}' not found in tenant '${args.tenant}': ${cErr?.message}`);
  }

  console.log(`[phase1] tenant=${args.tenant} (${tenantId})`);
  console.log(`[phase1] channel=whatsapp:${args.chat} (${channelRow.id})`);

  // Unzip to a temp directory
  const tmpDir = join(tmpdir(), `wa-phase1-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  console.log(`[phase1] unzipping ${args.zipPath} → ${tmpDir}`);
  const unzip = spawnSync('unzip', ['-q', args.zipPath, '-d', tmpDir]);
  if (unzip.status !== 0) {
    throw new Error(`unzip failed: ${unzip.stderr?.toString()}`);
  }

  // List files
  const files = await readdir(tmpDir);
  console.log(`[phase1] ${files.length} files extracted`);

  let nUploaded = 0;
  let nSkippedDup = 0;
  let nL0Inserted = 0;
  let nL0Existing = 0;
  let nErrors = 0;

  for (const filename of files) {
    const localPath = join(tmpDir, filename);
    const fileStat = await stat(localPath);
    if (!fileStat.isFile()) continue;

    let buf = await readFile(localPath);
    const mime = inferMimeType(filename);
    const isChat = filename === '_chat.txt';
    const remotePath = `${args.tenant}/${args.chat}/${filename}`;

    // 1. Upload to Storage
    if (isChat) {
      // _chat.txt: merge with existing remote copy (UNION of lines, preserving order from
      // first appearance). Re-exports may be a subset of history — never overwrite-shrink.
      const { data: existingBlob } = await db.storage.from('l0-whatsapp').download(remotePath);
      if (existingBlob) {
        const existingText = await existingBlob.text();
        const newText = buf.toString('utf-8');
        const merged = mergeChatTxt(existingText, newText);
        const mergedBuf = Buffer.from(merged, 'utf-8');
        const oldBytes = existingText.length;
        const newBytes = newText.length;
        const mergedBytes = merged.length;
        if (mergedBytes !== oldBytes) {
          const { error: upErr } = await db.storage
            .from('l0-whatsapp')
            .upload(remotePath, mergedBuf, { contentType: mime, upsert: true });
          if (upErr) {
            nErrors++;
            console.error(`  ✗ merged-upload ${filename}: ${upErr.message}`);
            continue;
          }
          nUploaded++;
          console.log(`  ↻ ${filename.padEnd(50)} merged: ${(oldBytes / 1024).toFixed(1)}K + ${(newBytes / 1024).toFixed(1)}K → ${(mergedBytes / 1024).toFixed(1)}K`);
          buf = mergedBuf;
        } else {
          nSkippedDup++;
          console.log(`  ⌥ ${filename.padEnd(50)} ${(oldBytes / 1024).toFixed(1)}K  ← _chat.txt (no new lines)`);
        }
        continue;
      }
      // No existing remote — just upload
      const { error: upErr } = await db.storage
        .from('l0-whatsapp')
        .upload(remotePath, buf, { contentType: mime, upsert: false });
      if (upErr) {
        nErrors++;
        console.error(`  ✗ upload ${filename}: ${upErr.message}`);
        continue;
      }
      nUploaded++;
      console.log(`  ⌥ ${filename.padEnd(50)} ${(buf.length / 1024).toFixed(1)}K  ← _chat.txt (first upload)`);
      continue;
    }

    const sha = sha256OfBuffer(buf);

    // Attachment: upload with upsert=false; treat 'Duplicate' error as success
    const { error: upErr } = await db.storage
      .from('l0-whatsapp')
      .upload(remotePath, buf, { contentType: mime, upsert: false });

    if (upErr) {
      const msg = upErr.message ?? '';
      if (msg.toLowerCase().includes('exists') || msg.toLowerCase().includes('duplicate')) {
        nSkippedDup++;
      } else {
        nErrors++;
        console.error(`  ✗ upload ${filename}: ${msg}`);
        continue;
      }
    } else {
      nUploaded++;
    }

    // 2. Insert l0_artifact (whatsapp_attachment) — sha-deduped via unique constraint
    const originAt = parseOriginAtFromFilename(filename) ?? new Date(fileStat.mtime).toISOString();

    const { data: existing } = await db
      .from('l0_artifacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sha256', sha)
      .maybeSingle();

    if (existing) {
      nL0Existing++;
      continue;
    }

    const { error: insErr } = await db.from('l0_artifacts').insert({
      tenant_id: tenantId,
      source_type: 'whatsapp_attachment',
      source_uri: `l0-whatsapp/${remotePath}`,
      sha256: sha,
      bytes: buf.length,
      origin_at: originAt,
      storage_url: `l0-whatsapp/${remotePath}`,
      metadata: {
        chat_slug: args.chat,
        tenant_slug: args.tenant,
        filename,
        mime_type: mime,
        msg_counter: filename.match(/^(\d{8})-/)?.[1] ?? null,
        kind:
          mime.startsWith('audio/') ? 'audio'
          : mime.startsWith('image/') ? 'image'
          : mime.startsWith('video/') ? 'video'
          : mime === 'application/pdf' ? 'pdf'
          : mime.includes('officedocument') ? 'office'
          : mime === 'application/zip' ? 'zip'
          : mime.startsWith('text/') || mime === 'application/json' ? 'text'
          : 'other',
      },
    });

    if (insErr) {
      nErrors++;
      console.error(`  ✗ l0_artifact ${filename}: ${insErr.message}`);
      continue;
    }
    nL0Inserted++;

    if (nL0Inserted % 25 === 0) {
      console.log(`  … ${nL0Inserted} l0_artifacts inserted`);
    }
  }

  console.log('');
  console.log(`[phase1] DONE`);
  console.log(`  files in zip:      ${files.length}`);
  console.log(`  uploaded to bucket: ${nUploaded}`);
  console.log(`  already in bucket:  ${nSkippedDup}`);
  console.log(`  l0_artifacts new:   ${nL0Inserted}`);
  console.log(`  l0_artifacts dup:   ${nL0Existing}`);
  console.log(`  errors:             ${nErrors}`);

  // Cleanup
  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('[phase1] fatal:', err);
  process.exit(1);
});
