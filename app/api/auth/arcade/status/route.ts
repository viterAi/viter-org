import { NextResponse } from "next/server";
import { Arcade } from "@arcadeai/arcadejs";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

  const apiKey = process.env.ARCADE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ARCADE_API_KEY not configured" }, { status: 500 });

  const client = new Arcade({ apiKey });
  const response = await client.auth.status({ id: authId });

  return NextResponse.json({ status: response.status ?? "pending" });
}
