import { NextResponse } from "next/server";
import {
  getMarkdownSeedDataset,
  type MarkdownSeedDataset,
} from "../../../lib/synthetic/ar-seed";
import { getSupabaseAdminClient } from "../../../lib/supabase/admin";

export async function POST() {
  const supabase = getSupabaseAdminClient();
  let dataset: MarkdownSeedDataset;
  try {
    dataset = await getMarkdownSeedDataset();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read markdown seed dataset.",
      },
      { status: 500 },
    );
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from("sources")
    .upsert(dataset.sources, { onConflict: "key" })
    .select("*");

  if (sourceError || !sourceRows) {
    return NextResponse.json(
      { error: sourceError?.message ?? "Failed to upsert sources" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    source: sourceRows[0] ?? null,
    sources: sourceRows,
    seeded_rows_in_markdown: dataset.invoices.length,
    message:
      "Loaded expanded seed package into sources.markdown only (no ar_invoices writes).",
  });
}
