# `@viter-org/adapter-whatsapp-gowa`

Self-hosted WhatsApp adapter for viter-org. Replaces UniPile-class third-party
SaaS with **[aldinokemal/go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice)** (GOWA),
a Railway-deployable Go binary built on **[tulir/whatsmeow](https://github.com/tulir/whatsmeow)**.

```
WhatsApp ←─[Signal protocol]─→ GOWA (Railway) ─[webhook]─→ Edge Function ─→ l0_artifacts → l1_events
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  viter-org repo                                                      │
│                                                                 │
│  manifests/gowa/0.1.0.yaml   ← typed contract (substrate moat) │
│                                                                 │
│  adapters/whatsapp-gowa/      ← THIS PACKAGE                    │
│  ├── src/client.ts            ← typed REST client               │
│  ├── src/types.ts             ← zod schemas + parser            │
│  ├── src/auth.ts              ← HMAC sign/verify                │
│  ├── scripts/backup-volume.ts ← nightly backup                  │
│  ├── tests/                   ← 19 fixture-based tests          │
│  └── RECOVERY.md              ← runbook for 6 failure modes     │
│                                                                 │
│  packages/orchestrator/src/trigger/                             │
│  ├── wa-pair-init.ts          ← create device + return QR       │
│  ├── wa-pair-poll.ts          ← wait for QR scan                │
│  ├── wa-send.ts               ← outbound, rate-limited          │
│  ├── wa-keepalive.ts          ← cron, 1 min cadence             │
│  ├── wa-health-check.ts       ← cron, 5 min cadence             │
│  └── wa-message-fan-out.ts    ← cron, 1 min — dispatch media    │
│                                                                 │
│  packages/runtime/src/                                          │
│  ├── extractors/whatsapp-message-live/   ← reusable ingest core │
│  └── principals/alias-resolver.ts        ← maps WA names →      │
│                                              viter-org principals    │
│                                                                 │
│  infra/supabase/                                                │
│  ├── migrations/                                                │
│  │   ├── 20260505200000_whatsapp_devices.sql                    │
│  │   ├── 20260505201000_whatsapp_live_source_type.sql           │
│  │   └── 20260505202000_principal_aliases_yitzchak.sql          │
│  └── functions/whatsapp-webhook/    ← receives GOWA webhooks    │
│                                                                 │
│  apps/web/app/                                                  │
│  ├── settings/whatsapp/page.tsx     ← device management UI      │
│  └── spaces/[slug]/inbox/page.tsx   ← live message stream       │
└─────────────────────────────────────────────────────────────────┘
```

## Database surface

| object | purpose |
|---|---|
| `public.whatsapp_devices` | bridge table: tenant ↔ paired phone ↔ GOWA device id |
| `public.whatsapp_device_health` | view: per-device health score 0-100 |
| `public.whatsapp_devices_needing_attention` | view: filter to red/yellow devices for alerting |
| `public.l0_source_types('whatsapp_message_live')` | source-type registration for live messages |
| `public.l0_artifacts` (existing) | one row per inbound WhatsApp message (live source type) |
| `public.l1_events` (existing) | parsed messages, transcripts, captions |

Idempotency: partial unique indexes on `metadata.gowa_message_id` prevent duplicate inserts on webhook retries.

## Deploy procedure (Railway)

1. **Create Railway project** in a viter team workspace (recommended) or your personal workspace
   - Path 1 in `00-stack-decision.pdf`: team workspace + custom domain from day 1 = zero migration cost later
2. **Add `adapter-whatsapp-gowa` service** using the upstream Docker image:
   - Image: `aldinokemal2104/go-whatsapp-web-multidevice:v8.4.0` (pin SHA in production)
   - Port: `3000`
   - Volume: 5 GB at `/app/storages`
3. **Set service env vars** (see `.env.example` for the full list):
   - `APP_BASIC_AUTH=admin:<random>`
   - `WHATSAPP_WEBHOOK=https://dkccadwohifcqcdzhhnu.supabase.co/functions/v1/whatsapp-webhook`
   - `WHATSAPP_WEBHOOK_SECRET=<openssl rand -hex 32>`
   - `WHATSAPP_WEBHOOK_EVENTS=message,message.ack,message.reaction,message.revoke,message.edited,device.connection.update,device.disconnected,device.banned,pair.qr.consumed`
4. **Set up custom domain** `gowa.viter.ai` → Railway service (CNAME)
5. **Set Supabase function secrets**:
   ```bash
   supabase secrets set --project-ref dkccadwohifcqcdzhhnu \
     GOWA_WEBHOOK_SECRET=<same-as-WHATSAPP_WEBHOOK_SECRET-above>
   ```
6. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy whatsapp-webhook --project-ref dkccadwohifcqcdzhhnu
   ```
7. **Pair first device** via `apps/web/settings/whatsapp` — should be ≤1 minute end-to-end

## Pair flow

```
User clicks "Pair new device"
       │
       ▼
apps/web server action calls GowaClient.createDevice()
       │
       ▼
GOWA returns { device_id, qr } — viter-org inserts whatsapp_devices(status='pending')
       │
       ▼
UI renders QR
       │
       ▼
User scans QR with phone
       │
       ▼
GOWA fires `pair.qr.consumed` webhook → viter-org Edge Function flips status='linked'
       │
       ▼
Real-time UI update (Realtime channel) — banner clears, "linked" badge shown
```

## Dev setup

```bash
pnpm install
pnpm --filter @viter-org/adapter-whatsapp-gowa typecheck
pnpm --filter @viter-org/adapter-whatsapp-gowa test
```

## Cost

| scenario | cost/mo |
|---|---|
| 1-30 devices | $20 (Railway Pro plan, $20 of usage included) |
| ~100 devices | $25-50 (one bigger Railway box) |
| vs UniPile (10 devices) | UniPile $55/mo → save $35/mo from month 1 |
| vs UniPile (100 devices) | UniPile $550+/mo → save ~$500/mo |

## Reliability

See `RECOVERY.md` for the full runbook. Summary:

| failure mode | frequency | recovery |
|---|---|---|
| Re-pair window | every 7-14 days/device | 30 sec QR rescan, predictable |
| Whatsmeow protocol patch | every 4-8 weeks (silent) | monthly upgrade window |
| Whatsmeow breaking change | every 3-9 months | wait 24-72 hr for upstream + redeploy |
| Railway/volume blip | every 2-6 months | service restart, volume backup if corrupt |
| WA-side disconnect | sporadic | whatsmeow auto-reconnect |
| Account ban (low traffic) | < 1 %/yr | tenant-side appeal flow |

## Sources

- [GOWA repo](https://github.com/aldinokemal/go-whatsapp-web-multidevice)
- [whatsmeow repo](https://github.com/tulir/whatsmeow)
- [Baileys (TS alternative we didn't pick)](https://github.com/WhiskeySockets/Baileys)
- [Vita stack decision (00-stack-decision.pdf)](../../00-stack-decision.pdf)
- Manifest: [`manifests/gowa/0.1.0.yaml`](../../manifests/gowa/0.1.0.yaml)
