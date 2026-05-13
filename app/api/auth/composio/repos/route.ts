import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasComposio } from "@/lib/composio/client";
import { assertComposioAccountOwnedByUser } from "@/lib/composio/accounts";
import { listGitHubReposForConnect } from "@/lib/composio/github-repos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authId = searchParams.get("auth_id");

  if (!authId) return NextResponse.json({ error: "Missing auth_id" }, { status: 400 });

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasComposio()) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not configured" }, { status: 500 });
  }

  try {
    await assertComposioAccountOwnedByUser(user.id, authId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }

  try {
    const repos = await listGitHubReposForConnect(user.id, authId);
    return NextResponse.json({ repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INITIATED") || message.includes("PENDING")) {
      return NextResponse.json({ error: "GitHub authorization not yet completed" }, { status: 202 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
