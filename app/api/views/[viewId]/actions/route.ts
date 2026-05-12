import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "../../../../../lib/supabase/server";

const actionSchema = z.object({
  action: z.enum(["mark_followed_up"]),
  payload: z.object({
    /** Stable genUI source key (e.g. `gmail:user@example.com`) or legacy UUID. */
    sourceId: z.string().min(1),
    invoiceId: z.string().min(1),
  }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  await params;
  actionSchema.parse(await request.json());

  return NextResponse.json({
    error:
      "Write-back actions are disabled in markdown-only mode. Regenerate or edit source markdown instead.",
  }, { status: 410 });
}
