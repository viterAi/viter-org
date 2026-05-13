import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasComposio } from "@/lib/composio/client";
import { getComposioAccessToken } from "@/lib/composio/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authId = searchParams.get("auth_id");
  const provider = searchParams.get("provider");

  if (!authId || !provider) {
    return NextResponse.json({ error: "Missing auth_id or provider" }, { status: 400 });
  }
  if (provider !== "google" && provider !== "microsoft") {
    return NextResponse.json({ error: "provider must be google or microsoft" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasComposio()) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not configured" }, { status: 500 });
  }

  const token = await getComposioAccessToken(authId);
  if (!token) {
    return NextResponse.json({ error: "Authorization not yet completed" }, { status: 202 });
  }

  if (provider === "google") {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!profileRes.ok) {
      return NextResponse.json({ error: "Failed to fetch Gmail profile" }, { status: 502 });
    }
    const profile = (await profileRes.json()) as { email?: string; name?: string };
    return NextResponse.json({
      mailboxes: [
        {
          id: profile.email ?? "primary",
          label: profile.email ?? "Primary inbox",
          email: profile.email ?? "",
        },
      ],
    });
  }

  const msRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!msRes.ok) {
    return NextResponse.json({ error: "Failed to fetch Outlook profile" }, { status: 502 });
  }
  const ms = (await msRes.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
  const email = ms.mail ?? ms.userPrincipalName ?? "primary";
  return NextResponse.json({
    mailboxes: [
      {
        id: email,
        label: ms.displayName ? `${ms.displayName} (${email})` : email,
        email,
      },
    ],
  });
}
