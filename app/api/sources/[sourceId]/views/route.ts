import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "../../../../../lib/supabase/admin";

const createViewSchema = z.object({
  viewName: z.string().min(1),
  viewType: z.enum(["aging_table", "follow_up_kanban"]),
  spec: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional().default(false),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("views")
    .select("*")
    .eq("source_id", sourceId)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ views: data });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const body = createViewSchema.parse(await request.json());
  const supabase = getSupabaseAdminClient();

  const { data: maxSortRecord } = await supabase
    .from("views")
    .select("sort_order")
    .eq("source_id", sourceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (body.isDefault) {
    await supabase
      .from("views")
      .update({ is_default: false })
      .eq("source_id", sourceId);
  }

  const nextSortOrder = (maxSortRecord?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("views")
    .insert({
      source_id: sourceId,
      view_name: body.viewName,
      view_type: body.viewType,
      sort_order: nextSortOrder,
      is_default: body.isDefault,
      current_spec_version: 1,
      spec: body.spec,
      ui_state: {},
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ view: data }, { status: 201 });
}
