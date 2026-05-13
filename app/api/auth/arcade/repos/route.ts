import { NextResponse } from "next/server";
import { Arcade } from "@arcadeai/arcadejs";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface GitHubRepo {
  full_name: string;
  description: string | null;
  private: boolean;
  pushed_at: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authId = searchParams.get("auth_id");

  if (!authId) return NextResponse.json({ error: "Missing auth_id" }, { status: 400 });

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const apiKey = process.env.ARCADE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ARCADE_API_KEY not configured" }, { status: 500 });

  const client = new Arcade({ apiKey });
  const authStatus = await client.auth.status({ id: authId });

  if (authStatus.status !== "completed" || !authStatus.context?.token) {
    return NextResponse.json({ error: "GitHub authorization not yet completed" }, { status: 202 });
  }

  const token = authStatus.context.token;
  // Include org repos the user can access via team/org membership (not just
  // owner/collaborator on personal repos). Paginate — GitHub caps at 100/page.
  const affiliation = "owner,collaborator,organization_member";
  const merged = new Map<string, GitHubRepo>();
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      sort: "pushed",
      per_page: "100",
      page: String(page),
      affiliation,
    });
    const ghRes = await fetch(`https://api.github.com/user/repos?${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!ghRes.ok) {
      const text = await ghRes.text();
      return NextResponse.json({ error: `GitHub API error: ${text}` }, { status: 502 });
    }

    const batch = (await ghRes.json()) as GitHubRepo[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (r?.full_name && !merged.has(r.full_name)) merged.set(r.full_name, r);
    }
    if (batch.length < 100) break;
  }

  const repos = Array.from(merged.values()).sort((a, b) => {
    const ta = a.pushed_at ? Date.parse(a.pushed_at) : 0;
    const tb = b.pushed_at ? Date.parse(b.pushed_at) : 0;
    return tb - ta;
  });

  return NextResponse.json({
    repos: repos.map((r) => ({
      full_name: r.full_name,
      description: r.description ?? "",
      private: r.private,
      pushed_at: r.pushed_at,
    })),
  });
}
