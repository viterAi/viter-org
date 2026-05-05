/**
 * GET /api/media/[artifactId] — resolves an l0_artifact id to a signed
 * Supabase Storage URL and redirects.
 *
 * Supported source_uri schemes (v0.1):
 *   l0-whatsapp/<path…>       — Supabase storage bucket+path (zip ingest)
 *   inbox/<path…>             — same, different bucket
 *   gowa://device/message/id  — TODO: proxy via GOWA basic-auth (live media)
 *   https://…                 — public URL, redirect as-is
 */

import { NextResponse } from 'next/server';
import { getCurrentTenantId, getServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  if (!isUuid(artifactId)) {
    return NextResponse.json({ error: 'invalid artifact id' }, { status: 400 });
  }

  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data: artifact, error } = await db
    .from('l0_artifacts')
    .select('id, source_uri, metadata')
    .eq('tenant_id', tenantId)
    .eq('id', artifactId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const uri = artifact.source_uri as string;

  // Public URL — safe to redirect directly
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    return NextResponse.redirect(uri);
  }

  // GOWA URL — needs basic-auth, browser can't follow. Phase 4.1 work.
  if (uri.startsWith('gowa://')) {
    return NextResponse.json(
      { error: 'live GOWA media proxy not implemented in v0.1' },
      { status: 501 },
    );
  }

  // Storage path: '<bucket>/<path…>'
  const slash = uri.indexOf('/');
  if (slash <= 0) {
    return NextResponse.json({ error: `unrecognized source_uri: ${uri}` }, { status: 415 });
  }
  const bucket = uri.slice(0, slash);
  const objectPath = uri.slice(slash + 1);

  const { data: signed, error: signErr } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `signed url failed: ${signErr?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }
  return NextResponse.redirect(signed.signedUrl);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
