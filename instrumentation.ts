/**
 * Next.js instrumentation — runs once per Node server process.
 *
 * Mail poll: set `MAIL_POLL_INTERVAL_MS` (e.g. `300000` for 5 minutes) to poll in-process.
 * Only reliable with a **long-lived** `next start` (Docker, Railway, Fly, a VM).
 * On **Vercel serverless**, intervals are ignored unless `MAIL_POLL_ALLOW_VERCEL_INTERVAL=1`
 * (not recommended: multiple instances would duplicate work).
 */

const globalMailPoll = globalThis as typeof globalThis & { __mailPollIntervalStarted?: boolean };

export async function register() {
  if (globalMailPoll.__mailPollIntervalStarted) return;

  const raw = process.env.MAIL_POLL_INTERVAL_MS;
  const ms = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(ms) || ms < 60_000) return;

  if (process.env.VERCEL === "1" && process.env.MAIL_POLL_ALLOW_VERCEL_INTERVAL !== "1") {
    console.warn(
      "[instrumentation] MAIL_POLL_INTERVAL_MS is set but ignored on Vercel (serverless). Self-host with `next start`, or ping GET /api/cron/mail-poll from an external scheduler.",
    );
    return;
  }

  globalMailPoll.__mailPollIntervalStarted = true;

  const { runMailPoll } = await import("@/lib/mail-poll/run-mail-poll");

  const tick = () => {
    void runMailPoll().catch((err) => console.error("[mail-poll] interval run failed:", err));
  };

  const initialDelayMs = Math.min(15_000, Math.max(0, Math.floor(ms / 10)));
  setTimeout(tick, initialDelayMs);
  setInterval(tick, ms);

  console.info(`[instrumentation] mail-poll: interval every ${ms}ms (first run in ${initialDelayMs}ms)`);
}
