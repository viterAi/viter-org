/**
 * GET /api/cron/genui-ingest
 *
 * Processes pending `genui_ingest_jobs` from GitHub webhooks into `genui_l2`.
 * Same auth model as `/api/cron/mail-poll` (`Authorization: Bearer <CRON_SECRET>`).
 */

import { NextResponse } from "next/server";
import { runGenuiIngestWorker } from "@/lib/genui/run-ingest-worker";

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

  const out = await runGenuiIngestWorker();
  if (!out.ok && out.error) {
    return NextResponse.json({ error: out.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, processed: out.processed, results: out.results });
}
