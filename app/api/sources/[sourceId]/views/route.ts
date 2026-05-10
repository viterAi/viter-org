import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "../../../../../lib/supabase/server";

const createViewSchema = z.object({
  viewName: z.string().min(1).default("Default"),
  viewType: z.string().default("spatial"),
  spec: z.record(z.string(), z.unknown()).optional().default({}),
  aiPages: z.array(z.unknown()).optional(),
  isDefault: z.boolean().optional().default(true),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

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
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Resolve tenant for the record. Falls back to null when the RLS context cannot resolve it.
  const { data: memberData } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .limit(1)
    .maybeSingle();
  const tenantData = memberData?.tenant_id ?? null;

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

  const spec = {
    ...body.spec,
    ...(body.aiPages ? { ai_pages: body.aiPages } : {}),
  };

  const { data, error } = await supabase
    .from("views")
    .insert({
      source_id: sourceId,
      view_name: body.viewName,
      view_type: body.viewType,
      sort_order: nextSortOrder,
      is_default: body.isDefault,
      current_spec_version: 1,
      spec,
      ui_state: {},
      tenant_id: tenantData ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ view: data }, { status: 201 });
}
