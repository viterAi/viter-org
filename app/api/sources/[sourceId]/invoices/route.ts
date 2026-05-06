import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { parseSourceRows } from "../../../../../lib/source-data/parse-source-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const status = request.nextUrl.searchParams.get("status");
  const supabase = getSupabaseAdminClient();

  const { data: sourceMeta, error: sourceError } = await supabase
    .from("sources")
    .select("markdown,seed_format")
    .eq("id", sourceId)
    .maybeSingle();

  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 });
  }

  if (!sourceMeta) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  const allRows = parseSourceRows({
    markdown: sourceMeta.markdown ?? "",
    seedFormat: (sourceMeta.seed_format ?? "markdown") as "markdown" | "json" | "csv",
  });

  const rows = status
    ? allRows.filter((row) => String(row.follow_up_status ?? "") === status)
    : allRows;

  return NextResponse.json({ invoices: rows });
}
