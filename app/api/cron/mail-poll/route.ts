/**
 * GET /api/cron/mail-poll
 *
 * Optional HTTP entrypoint for the same logic as the in-process scheduler in
 * `instrumentation.ts` (when `MAIL_POLL_INTERVAL_MS` is set on a long-lived Node host).
 *
 * For ad-hoc or external schedulers (curl, GitHub Actions, k8s CronJob), call this route
 * with `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set.
 */

import { NextResponse } from "next/server";
import { runMailPoll } from "@/lib/mail-poll/run-mail-poll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const out = await runMailPoll();
  if (!out.ok && out.error) {
    return NextResponse.json({ error: out.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results: out.results });
}
