# GOWA Recovery Runbook

**Owner:** Yitzchak (Tsar of security, integration, and support — declared 2026-03-23 by Shaul)
**Last reviewed:** 2026-05-05
**On-call query:** `select * from public.whatsapp_devices_needing_attention;`

This runbook covers the 6 failure modes the WhatsApp adapter can hit. Each
section: detection signal · diagnostic queries · recovery steps · expected
resolution time · escalation path. Read top-to-bottom on first incident.

---

## Mode 1 · Re-pair window (every 7-14 days, predictable)

### Signal
- `whatsapp_device_health.health_score` < 70 with `days_until_re_pair` ≤ 3
- UI shows yellow "Refresh WhatsApp link" banner per device
- Trigger.dev `wa-health-check` run tagged `wa:health-alert`

### Diagnose
```sql
select id, tenant_id, phone_number, days_until_re_pair, last_seen_at
from public.whatsapp_device_health
where days_until_re_pair is not null and days_until_re_pair <= 3
order by days_until_re_pair asc;
```

### Recover
1. Tenant clicks "Refresh link" in apps/web settings page
2. UI calls `wa-pair-init` task → returns fresh QR
3. Tenant scans → `pair.qr.consumed` webhook fires
4. Edge Function flips status to `linked`, resets `expires_at`
5. UI refreshes — banner clears

**Expected resolution time:** 30 seconds, no engineering involvement.

### Escalate if
- QR isn't consumed within 60s × 3 retries — manual investigation of phone connectivity / WA app version

---

## Mode 2 · Silent whatsmeow field addition

### Signal
- GOWA logs warnings about "unknown field"
- No user-visible breakage
- Trigger.dev runs continue green

### Diagnose
```bash
railway logs --service adapter-whatsapp-gowa | grep -i "unknown\|unhandled\|deprecated"
```

### Recover
1. Watch upstream `whatsmeow` releases
2. When a new GOWA Docker tag drops with the fix, schedule monthly upgrade window:
   ```bash
   railway service redeploy --image aldinokemal2104/go-whatsapp-web-multidevice:vX.Y.Z
   ```
3. Verify all devices reconnect within 60s post-redeploy

**Expected resolution time:** 30 min, monthly cadence (not incident-driven).

---

## Mode 3 · Whatsmeow protocol breaking change (1-3× per year)

### Signal
- Multiple devices simultaneously transition to `disconnected` or `expired`
- `wa-health-check` shows widespread health_score drops within minutes
- GOWA logs full of decryption errors

### Diagnose
```sql
-- Did we just lose multiple devices simultaneously?
select status, count(*), max(updated_at) as last_change
from public.whatsapp_devices
group by status
order by last_change desc;
```

Check upstream:
- https://github.com/tulir/whatsmeow/issues  (active discussion of breaks)
- https://github.com/aldinokemal/go-whatsapp-web-multidevice/releases  (fix availability)

### Recover (in order)
1. **Confirm it's protocol-side, not local.** Check Railway service health, network, Supabase status. If those are green, suspect protocol.
2. **Wait for upstream patch.** Tulir's track record: 24-72 hours to ship a fix. Watch his GitHub.
3. **Pull the new GOWA image** when released:
   ```bash
   railway service redeploy --image aldinokemal2104/go-whatsapp-web-multidevice:vX.Y.Z
   ```
4. **Verify reconnection.** Run `wa-health-check` manually; expect majority to flip back to `linked` within 5 min.
5. **Re-pair stragglers** that didn't auto-recover via the standard pair flow.
6. **Communicate to tenants:** brief incident note via the channel they're paired in, explaining the gap.

### Worst-case fallback (if upstream is silent > 72 hours)
- Rollback to the previous GOWA image SHA
- Document the regression for tulir to investigate

**Expected resolution time:** 24-72 hr (gated on upstream patch). Engineering: ~2-3 hours of work spread across the window.

---

## Mode 4 · Railway / volume failure

### Signal
- Railway dashboard shows the service in a crashed/restarting state
- Trigger.dev `wa-keepalive` task failing GOWA pings
- All devices simultaneously `disconnected` (not selective like protocol break)

### Diagnose
```bash
railway logs --service adapter-whatsapp-gowa --tail 200
railway service status
```

### Recover (case A — service crash, volume intact)
1. `railway service restart`
2. Watch logs for "WhatsApp REST server running on :3000"
3. Devices auto-reconnect via whatsmeow's built-in logic; expect all `linked` within 5 min

### Recover (case B — volume corrupt or lost)
1. Find latest good backup:
   ```sql
   select * from storage.objects
   where bucket_id = 'whatsapp-gowa-backups'
   order by created_at desc limit 5;
   ```
2. Download and restore:
   ```bash
   supabase storage cp 'whatsapp-gowa-backups/daily/<YYYY-MM-DD>.tar.gz' ./gowa-restore.tar.gz
   railway run tar -xzf gowa-restore.tar.gz -C /app/storages/
   railway service restart
   ```
3. Devices should reconnect within 5 min using restored session keys.
4. Some devices may still need re-pair if backup is > 7 days old (multi-device window).

**Expected resolution time:**
- Case A: 5 min, no data loss
- Case B: 30 min, lose at most 24 hours of session state

### Escalate if
- Backup itself is corrupt (rare — verify with `tar -tzf` on a recent backup periodically)
- Multiple successive backups missing (indicates the backup script itself broke)

---

## Mode 5 · WhatsApp-side connectivity drop

### Signal
- Single device flips to `disconnected`
- `last_seen_at` getting older
- Other devices on the same Railway box are fine

### Diagnose
```sql
select id, phone_number, status, last_seen_at, last_error
from public.whatsapp_devices
where status = 'disconnected';
```

### Recover
1. **Wait 10 minutes** — whatsmeow's auto-reconnect with exponential backoff handles most cases.
2. If still disconnected:
   - Check the phone is online + has internet
   - Check WhatsApp on the phone isn't showing "linked device disconnected"
   - If phone shows the linked device active, the issue is on GOWA side: `railway service restart`
3. If GOWA side has been hit > 3× in 24 hours for the same device, suspect a bad multi-device session and force re-pair.

**Expected resolution time:** typically auto-resolves in 1-5 min. Manual: 5-10 min.

---

## Mode 6 · Account ban / flag

### Signal
- `whatsapp_devices.status = 'banned'`
- Webhook event `device.banned` fired
- Tenant reports "WhatsApp says my account is suspended"

### Diagnose
```sql
select id, phone_number, banned_at, last_error, metadata
from public.whatsapp_devices where status = 'banned';
```

Audit recent outbound rate:
```sql
select date_trunc('hour', event_at) as hour, count(*) as n
from public.l1_events
where metadata->>'gowa_device_id' = '<id>' and metadata->>'from_me' = 'true'
group by 1 order by 1 desc limit 24;
```

### Recover
1. **Immediately stop all outbound** to that device (set rate limit to 0):
   ```sql
   update public.whatsapp_devices
      set metadata = jsonb_set(metadata, '{outbound_rate_limit_per_minute}', '0')
    where id = '<id>';
   ```
2. **Tenant appeal flow** via WhatsApp's built-in account-recovery UI:
   - Phone → WhatsApp → Settings → Account → Request a Review
   - Provide context: business use case, no spam intent
3. **Wait for resolution** — typical:
   - First-time soft ban: 24-72 hours
   - Repeat offense: permanent
4. **Post-mortem:** identify which behavior triggered the flag (rate, recipient mismatch, content). Update `wa-send` rate limits + add tenant-side education.
5. **Failover** for critical tenants: if a backup phone number is paired, swap channel binding to it.

**Expected resolution time:** out of our hands — 24h to permanent. **Prevention is the real defense.**

### Prevention checklist
- [ ] `wa-send` rate limit ≤ 8 msg/min/device
- [ ] Outbound jitter ±1.5s
- [ ] No outbound during 02:00-06:00 local
- [ ] Don't message numbers that haven't messaged you first
- [ ] Don't send identical text to >5 recipients within 60s
- [ ] Use Cloud API for high-volume outbound (>100 msg/day)

---

## Decision tree — first 60 seconds of an incident

```
Symptom: "WhatsApp not working"
        │
        ▼
Single device or multiple?
        │
        ├── Single → Mode 5 (connectivity) or Mode 6 (ban)
        │           Check status field → 'banned' = Mode 6, else Mode 5
        │
        └── Multiple/all
                │
                ▼
        Railway service running?
                │
                ├── No → Mode 4 (infra)
                │
                └── Yes
                        │
                        ▼
                Last seen > 5 min ago?
                        │
                        ├── No → False alarm, check alert rule
                        │
                        └── Yes → Logs show decrypt errors? → Mode 3 (protocol)
                                                          else → Mode 4 case A
```

---

## Recovery exercise (run quarterly)

To prevent runbook-rot, deliberately break each failure mode in staging
once per quarter. Goals:
- Confirm queries still match schema
- Confirm CLI commands still work with current Railway version
- Confirm backup restore actually produces a working volume
- Update timing estimates based on observed reality

Last exercise: (none yet — schedule first one within 30 days of v0.1 launch).
