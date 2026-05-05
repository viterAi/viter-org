/**
 * scripts/backup-volume.ts
 *
 * Backs up GOWA's session-DB volume to Supabase Storage.
 *
 * The /app/storages/sessions/*.db files contain Signal-protocol session
 * keys per linked device. **Lose them and every device must re-pair.**
 * Nightly snapshot is the difference between "30-second QR rescan per
 * tenant" and "every customer's WhatsApp goes dark for an hour."
 *
 * Designed to run two ways:
 *   1. As a Trigger.dev cron (production) — scheduled nightly, posts to
 *      the GOWA admin endpoint to fetch the volume contents
 *   2. As a manual CLI (recovery / debugging) — operator runs locally,
 *      tars the volume from a Railway shell + uploads
 *
 * Strategy: GOWA exposes no native "download all sessions" endpoint, so
 * this script uses Railway's CLI to exec into the container, runs `tar`
 * over /app/storages, streams to local disk, then uploads the tar file
 * to Supabase Storage `whatsapp-gowa-backups/<YYYY-MM-DD>.tar.gz`.
 *
 * Retention: 30 days rolling, pruned by a separate cleanup pass.
 *
 * Env:
 *   RAILWAY_TOKEN          — for `railway run` shell access
 *   RAILWAY_SERVICE_ID     — the GOWA service id
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GOWA_BACKUP_BUCKET     — default 'whatsapp-gowa-backups'
 *
 * Usage (manual):
 *   npx tsx --env-file=.env.local adapters/whatsapp-gowa/scripts/backup-volume.ts
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = process.env.GOWA_BACKUP_BUCKET ?? 'whatsapp-gowa-backups';
const RETENTION_DAYS = 30;

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1. Ensure bucket exists (idempotent)
  await ensureBucket(supabase);

  // 2. Tar the GOWA volume via railway run
  const dir = mkdtempSync(join(tmpdir(), 'gowa-backup-'));
  const tarPath = join(dir, `gowa-${new Date().toISOString().slice(0, 10)}.tar.gz`);
  const ok = tarVolumeViaRailway(tarPath);
  if (!ok) {
    console.error('[backup] tar failed — aborting');
    process.exit(1);
  }

  // 3. Upload to Supabase Storage
  const buf = readFileSync(tarPath);
  const remoteKey = `daily/${new Date().toISOString().slice(0, 10)}.tar.gz`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(remoteKey, buf, {
      contentType: 'application/gzip',
      upsert: true,
    });
  if (upErr) {
    console.error(`[backup] upload failed: ${upErr.message}`);
    process.exit(1);
  }
  console.log(`[backup] uploaded ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${BUCKET}/${remoteKey}`);

  // 4. Prune > RETENTION_DAYS old files
  await pruneOld(supabase);

  // 5. Cleanup
  rmSync(dir, { recursive: true, force: true });
  console.log('[backup] done');
}

async function ensureBucket(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.storage.listBuckets();
  const exists = (data ?? []).some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error) console.warn(`[backup] bucket create warn: ${error.message}`);
  }
}

function tarVolumeViaRailway(outPath: string): boolean {
  // Requires RAILWAY_TOKEN + RAILWAY_SERVICE_ID + a logged-in railway CLI
  const cmd = spawnSync(
    'railway',
    ['run', 'tar', '-czf', '-', '/app/storages/sessions'],
    {
      env: { ...process.env, RAILWAY_TOKEN: process.env.RAILWAY_TOKEN },
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 1024 * 1024 * 200,    // 200 MB
    },
  );
  if (cmd.status !== 0 || !cmd.stdout) {
    return false;
  }
  // Write the tarball to disk
  spawnSync('sh', ['-c', `cat > ${outPath}`], { input: cmd.stdout });
  return true;
}

async function pruneOld(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.storage.from(BUCKET).list('daily');
  if (!data) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const toDelete = data
    .filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)
    .map((f) => `daily/${f.name}`);
  if (toDelete.length === 0) return;
  await supabase.storage.from(BUCKET).remove(toDelete);
  console.log(`[backup] pruned ${toDelete.length} files older than ${RETENTION_DAYS} days`);
}

main().catch((err) => {
  console.error('[backup] fatal:', err);
  process.exit(1);
});
