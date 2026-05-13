import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getComposioClient, hasComposio } from "@/lib/composio/client";
import { assertComposioAccountOwnedByUser } from "@/lib/composio/accounts";

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
    const composio = getComposioClient();
    const account = await composio.connectedAccounts.get(authId);
    if (account.status === "ACTIVE") {
      return NextResponse.json({ status: "completed", auth_id: account.id });
    }
    return NextResponse.json({ status: "pending", account_status: account.status });
  } catch {
    return NextResponse.json({ status: "pending" });
  }
}
