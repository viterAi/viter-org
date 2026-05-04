/**
 * Trigger.dev v4 config — viter substrate ingest pipeline.
 *
 * Project: cloud.trigger.dev/orgs/mordechai-33b2/projects/test-JeHj
 *
 * Tasks live in src/trigger/. Run `pnpm trigger:dev` from this package.
 *
 * Env required at runtime (set in Trigger.dev dashboard per environment):
 *   SUPABASE_URL                  — viter Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — bypasses RLS for ingest writes
 *   OPENROUTER_API_KEY            — billing falls on this key
 */

import { defineConfig } from '@trigger.dev/sdk';
import { ffmpeg } from '@trigger.dev/build/extensions/core';

export default defineConfig({
  // Replace with the `proj_` ref from your dashboard if needed.
  project: 'test-JeHj',
  runtime: 'node',
  logLevel: 'info',
  // ingest-zip orchestrator can run for many minutes on a big chat;
  // child tasks complete in seconds.
  maxDuration: 1800,
  dirs: ['./src/trigger'],
  build: {
    extensions: [
      // Installs ffmpeg in the deploy image so the audio extractor's
      // opus→wav transcode works without any wasm fallback.
      ffmpeg(),
    ],
    external: ['mammoth', 'xlsx'],
  },
});
