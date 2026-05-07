import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "../../../lib/supabase/admin";

const createSourceSchema = z.object({
  name: z.string().trim().min(1),
  key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9_-]+$/),
  channel: z.string().trim().min(1).default("manual_upload"),
  seedFormat: z.enum(["markdown", "json", "csv"]),
  markdown: z.string().default(""),
  description: z.string().nullable().optional(),
});

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sources: data });
}

export async function POST(request: Request) {
  const parsed = createSourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid source payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sources")
    .insert({
      key: parsed.data.key,
      name: parsed.data.name,
      channel: parsed.data.channel,
      seed_format: parsed.data.seedFormat,
      markdown: parsed.data.markdown,
      description: parsed.data.description ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ source: data }, { status: 201 });
}
