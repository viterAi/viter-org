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
  const ghRes = await fetch("https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator", {
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

  const repos = (await ghRes.json()) as GitHubRepo[];
  return NextResponse.json({
    repos: repos.map((r) => ({
      full_name: r.full_name,
      description: r.description ?? "",
      private: r.private,
      pushed_at: r.pushed_at,
    })),
  });
}
