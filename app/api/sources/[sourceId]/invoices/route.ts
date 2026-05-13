import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../../../lib/supabase/server";
import {
  fetchL2RowsForSource,
  l2RowsToSourceDataRows,
  resolveSourceKey,
} from "../../../../../lib/genui/l2-source";

/**
 * Returns the rows backing the active saved layout for a source.
 *
 * Historically this powered an "invoices" view over a markdown-seeded source
 * table. The view-builder canvas now sources its data from `genui_l2`, so this
 * route returns the same L2 rows that `…/canvas` would feed the AI — just
 * without the AI plan/fill stages. Frontend hooks call this on saved-layout
 * load to hydrate row-dependent components (tables, charts, activity feeds).
 *
 * The response shape (`{ invoices: SourceDataRow[] }`) is preserved for
 * backward compatibility with existing callers.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { sourceId } = await params;
  const sourceKey = decodeURIComponent(sourceId);

  const resolved = await resolveSourceKey(supabase, sourceKey);
  if (!resolved) {
    return NextResponse.json({ invoices: [] });
  }

  const l2Rows = await fetchL2RowsForSource(supabase, resolved);
  const rows = l2RowsToSourceDataRows(l2Rows, resolved.kind);

  return NextResponse.json({ invoices: rows });
}
