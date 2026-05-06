import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["mark_followed_up"]),
  payload: z.object({
    sourceId: z.string().uuid(),
    invoiceId: z.string().min(1),
  }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  await params;
  actionSchema.parse(await request.json());

  return NextResponse.json({
    error:
      "Write-back actions are disabled in markdown-only mode. Regenerate or edit source markdown instead.",
  }, { status: 410 });
}
