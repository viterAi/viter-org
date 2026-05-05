/**
 * /settings/whatsapp — WhatsApp device management
 *
 * Server component. Lists all whatsapp_devices for the current tenant, with
 * health badge, last-seen, days-until-re-pair, and unlink action. Mirrors
 * the layout Yitzchak sketched in his May 3 wireframe (sources tab on the
 * left, this is a single source's settings).
 */

import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';
import { PairButton } from './PairButton';
import { unlinkDevice, refreshDeviceStatuses } from './actions';

export const dynamic = 'force-dynamic';

interface DeviceHealthRow {
  id: string;
  gowa_device_id: string;
  phone_number: string | null;
  display_name: string | null;
  status: string;
  last_seen_at: string | null;
  days_until_re_pair: number | null;
  health_score: number;
  banned_at: string | null;
  last_error: string | null;
  latest_message_at: string | null;
}

async function getDevices(): Promise<DeviceHealthRow[]> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();
  const { data, error } = await db
    .from('whatsapp_device_health')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('health_score', { ascending: true });
  if (error) throw new Error(`load devices: ${error.message}`);
  return (data ?? []) as DeviceHealthRow[];
}

function StatusBadge({ status, score }: { status: string; score: number }) {
  const colour =
    status === 'linked' && score >= 70 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
    status === 'linked'                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300' :
    status === 'banned'                ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' :
    status === 'pending'               ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' :
                                         'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colour}`}>
      {status} · {score}
    </span>
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ageS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (ageS < 60) return `${ageS}s ago`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
  if (ageS < 86_400) return `${Math.floor(ageS / 3600)}h ago`;
  return `${Math.floor(ageS / 86_400)}d ago`;
}

export default async function WhatsAppSettingsPage() {
  const devices = await getDevices();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp devices</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Each row is a phone paired with vita via GOWA. Re-pair every ~13 days.
          </p>
        </div>
        <form
          action={async () => {
            'use server';
            await refreshDeviceStatuses();
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Refresh status
          </button>
        </form>
      </header>

      <section className="mb-8">
        <PairButton />
      </section>

      <section>
        {devices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No paired devices yet. Click <strong>Pair new WhatsApp device</strong> above to start.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {d.display_name || d.gowa_device_id}
                    </p>
                    <StatusBadge status={d.status} score={d.health_score} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {d.phone_number ? <>📱 {d.phone_number} · </> : null}
                    last seen {fmtRelative(d.last_seen_at)}
                    {d.days_until_re_pair != null && (
                      <> · re-pair in {d.days_until_re_pair}d</>
                    )}
                    {d.latest_message_at && (
                      <> · last msg {fmtRelative(d.latest_message_at)}</>
                    )}
                  </p>
                  {d.last_error && (
                    <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">
                      ⚠ {d.last_error}
                    </p>
                  )}
                </div>
                <form
                  action={async () => {
                    'use server';
                    await unlinkDevice(d.id);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-red-50 dark:border-zinc-700 dark:hover:bg-red-950"
                  >
                    Unlink
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
