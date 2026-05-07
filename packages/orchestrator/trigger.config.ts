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
import { ffmpeg, aptGet, additionalFiles } from '@trigger.dev/build/extensions/core';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Workspace adapter vendoring + alias.
 *
 * Trigger.dev's deploy uploads only this package's tracked git files; the
 * pnpm symlinks pointing at sibling workspace packages (../../adapters/...,
 * ../runtime/) are NOT followed during upload. So esbuild on the build
 * server can't resolve `@vita/adapter-whatsapp-gowa` or `@vita/runtime`.
 *
 * Fix: vendor the deps' built dist/ + the runtime's source-only subpath
 * exports into a local `vendored/` folder (committed to git), and register
 * an esbuild alias plugin that redirects bare imports to those local files.
 *
 * Layout: paths avoid `dist/` because the global .gitignore excludes that
 * pattern, which would strip the files from trigger.dev's git-aware upload.
 */
function vendorWorkspaceDeps() {
  const vendorRoot = resolve(__dirname, 'vendored');

  const adapterDist = resolve(__dirname, '../../adapters/whatsapp-gowa/dist');
  const runtimeDist = resolve(__dirname, '../runtime/dist');
  const runtimeSrc = resolve(__dirname, '../runtime/src');

  const haveSources = existsSync(adapterDist) && existsSync(runtimeDist) && existsSync(runtimeSrc);
  if (!haveSources) {
    // Build server / runtime container — trust whatever is at vendored/
    // (or nothing — the alias plugin only runs at build time).
    return vendorRoot;
  }

  if (existsSync(vendorRoot)) {
    execSync(`rm -rf "${vendorRoot}"`);
  }
  mkdirSync(vendorRoot, { recursive: true });

  cpSync(adapterDist, resolve(vendorRoot, 'adapter-whatsapp-gowa'), { recursive: true });
  cpSync(runtimeDist, resolve(vendorRoot, 'runtime-dist'), { recursive: true });
  cpSync(runtimeSrc, resolve(vendorRoot, 'runtime-src'), { recursive: true });

  return vendorRoot;
}

const VENDOR_ROOT = vendorWorkspaceDeps();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aliasWorkspaceDepsExtension: any = {
  name: 'alias-workspace-deps',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBuildStart: async (context: any) => {
    const aliasMap: Record<string, string> = {
      '@vita/adapter-whatsapp-gowa': resolve(VENDOR_ROOT, 'adapter-whatsapp-gowa/index.js'),
      '@vita/runtime': resolve(VENDOR_ROOT, 'runtime-dist/index.js'),
      '@vita/runtime/extractors-attachments': resolve(VENDOR_ROOT, 'runtime-src/extractors/attachments/dispatcher.ts'),
      '@vita/runtime/extractors-meeting': resolve(VENDOR_ROOT, 'runtime-src/extractors/meeting/index.ts'),
      '@vita/runtime/llm-log': resolve(VENDOR_ROOT, 'runtime-src/llm-log/index.ts'),
      '@vita/runtime/synthesizers': resolve(VENDOR_ROOT, 'runtime-dist/synthesizers/index.js'),
      '@vita/runtime/types': resolve(VENDOR_ROOT, 'runtime-dist/types.js'),
    };
    context.registerPlugin({
      name: 'alias-workspace-deps',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setup(build: any) {
        build.onResolve({ filter: /^@vita\// }, (args: { path: string }) => {
          const target = aliasMap[args.path];
          if (!target) return null;
          return { path: target };
        });
      },
    });
  },
};

export default defineConfig({
  project: 'proj_hvcfyxehhvtsodxlicvb',
  runtime: 'node',
  logLevel: 'info',
  // ingest-zip orchestrator can run for many minutes on a big chat;
  // child tasks complete in seconds.
  maxDuration: 1800,
  dirs: ['./src/trigger'],
  build: {
    extensions: [
      ffmpeg(),
      aptGet({ packages: ['unzip'] }),
      additionalFiles({ files: ['vendored/**'] }),
      aliasWorkspaceDepsExtension,
    ],
    external: ['mammoth', 'xlsx'],
  },
});
