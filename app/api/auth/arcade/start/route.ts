import { NextResponse } from "next/server";
import { Arcade } from "@arcadeai/arcadejs";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PROVIDER_SCOPES: Record<string, string[]> = {
  github: ["repo", "admin:repo_hook"],
  google: ["https://www.googleapis.com/auth/gmail.readonly"],
  microsoft: ["https://graph.microsoft.com/Mail.Read", "offline_access"],
};

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { provider?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider ?? "";
  if (!PROVIDER_SCOPES[provider]) {
    return NextResponse.json(
      { error: `Unknown provider. Supported: ${Object.keys(PROVIDER_SCOPES).join(", ")}` },
      { status: 400 },
    );
  }

  const apiKey = process.env.ARCADE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ARCADE_API_KEY not configured" }, { status: 500 });
  }

  const client = new Arcade({ apiKey });

  // Use email (preferred) or UUID as the stable user_id for this auth flow.
  // The verify route (/api/auth/arcade/verify) must pass the same value to confirmUser.
  const arcadeUserId = user.email ?? user.id;
  const response = await client.auth.start(arcadeUserId, provider, {
    scopes: PROVIDER_SCOPES[provider],
  });

  if (response.status === "completed") {
    return NextResponse.json({ status: "already_authorized", auth_id: response.id });
  }

  if (response.status === "pending" && response.url) {
    return NextResponse.json({ status: "auth_required", auth_url: response.url, auth_id: response.id });
  }

  return NextResponse.json({ error: `Unexpected auth status: ${response.status ?? "unknown"}` }, { status: 500 });
}
