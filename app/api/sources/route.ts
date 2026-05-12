import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabase/server";
import { buildSourceTree } from "../../../lib/genui/l2-source";

export const dynamic = "force-dynamic";

/**
 * Returns the sidebar tree (`kind → groups[]` for kinds with grouping, else
 * `kind → channels[]`) and a flat union of source leaves for backward-compat
 * with callers that don't read the tree yet.
 *
 * Both `sources` and `tree[].groups[]` use stable string keys:
 *   - channel form: `<kind>:<external_key>`
 *   - group form:   `<kind>::<group_field>=<group_value>`
 *
 * RLS scopes everything to the caller's tenant + visibility automatically.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { tree, flatSources } = await buildSourceTree(supabase);
  return NextResponse.json({ sources: flatSources, tree });
}
