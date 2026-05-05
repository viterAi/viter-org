'use server';

/**
 * Server actions for the meetings upload surface.
 *
 * The browser uploads audio bytes directly to Supabase Storage at
 *   `inbox/<tenant>/meetings/<slug>/<filename>`
 * The `inbox-webhook` Edge Function dispatches to the `ingest-meeting`
 * Trigger.dev task on object-created. RLS on the inbox bucket gates
 * uploads on `user_can_read_channel(meeting:<slug>)` — so the channel
 * row must exist before the user can drop a file.
 *
 * `ensureMeetingChannel` upserts the channel row + returns the canonical
 * upload prefix the client should use. Service-role bypasses RLS for the
 * upsert so this works even before auth is fully wired.
 */

import { revalidatePath } from 'next/cache';
import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';

export interface EnsureMeetingChannelArgs {
  meeting_slug: string;
  display_name?: string;
  location?: string;
}

export interface EnsureMeetingChannelResult {
  ok: boolean;
  error?: string;
  tenant_slug?: string;
  meeting_slug?: string;
  channel_id?: string;
  upload_prefix?: string;            // e.g. 'viter/meetings/ahiya-2026-05-05/'
}

const SLUG_RX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function ensureMeetingChannel(args: EnsureMeetingChannelArgs): Promise<EnsureMeetingChannelResult> {
  const meetingSlug = args.meeting_slug.trim().toLowerCase();
  if (!meetingSlug || !SLUG_RX.test(meetingSlug)) {
    return { ok: false, error: 'slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen)' };
  }
  if (meetingSlug.length > 80) {
    return { ok: false, error: 'slug must be ≤ 80 characters' };
  }

  const db = getServiceRoleClient();
  const tenantId = await getCurrentTenantId();

  const { data: tenantRow } = await db.from('tenants').select('slug').eq('id', tenantId).single();
  const tenantSlug = (tenantRow?.slug as string) ?? 'viter';

  const metadata: Record<string, unknown> = {
    ingest_source: 'inbox-webhook',
    created_via: 'apps/web/meetings',
  };
  if (args.location) metadata.location = args.location;

  const { data: ch, error: chErr } = await db
    .from('channels')
    .upsert(
      {
        tenant_id: tenantId,
        kind: 'meeting',
        identifier: meetingSlug,
        display_name: args.display_name?.trim() || `meeting: ${meetingSlug}`,
        metadata,
      },
      { onConflict: 'tenant_id,kind,identifier' },
    )
    .select('id')
    .single();

  if (chErr || !ch) {
    return { ok: false, error: `channel upsert: ${chErr?.message ?? 'unknown error'}` };
  }

  revalidatePath('/meetings');

  return {
    ok: true,
    tenant_slug: tenantSlug,
    meeting_slug: meetingSlug,
    channel_id: ch.id as string,
    upload_prefix: `${tenantSlug}/meetings/${meetingSlug}/`,
  };
}

/** Generate a default slug from today's date — used as the form's initial value. */
export async function suggestMeetingSlug(): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  return `meeting-${yyyy}-${mm}-${dd}-${hh}00`;
}
