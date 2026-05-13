import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasComposio } from "@/lib/composio/client";
import { assertComposioAccountOwnedByUser } from "@/lib/composio/accounts";
import { executeComposioTool } from "@/lib/composio/execute";

export const dynamic = "force-dynamic";

type GitHubRepo = {
  full_name?: string;
  description?: string | null;
  private?: boolean;
  pushed_at?: string;
};

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
    const data = await executeComposioTool<{ repositories?: GitHubRepo[] }>({
      slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
      userId: user.id,
      connectedAccountId: authId,
      arguments: { per_page: 100, sort: "pushed" },
    });
    const repos = (data.repositories ?? []).sort((a, b) => {
      const ta = a.pushed_at ? Date.parse(a.pushed_at) : 0;
      const tb = b.pushed_at ? Date.parse(b.pushed_at) : 0;
      return tb - ta;
    });
    return NextResponse.json({
      repos: repos.map((r) => ({
        full_name: r.full_name ?? "",
        description: r.description ?? "",
        private: Boolean(r.private),
        pushed_at: r.pushed_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INITIATED") || message.includes("PENDING")) {
      return NextResponse.json({ error: "GitHub authorization not yet completed" }, { status: 202 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
