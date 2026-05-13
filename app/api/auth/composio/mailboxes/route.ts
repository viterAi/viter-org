import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasComposio } from "@/lib/composio/client";
import { assertComposioAccountOwnedByUser } from "@/lib/composio/accounts";
import { executeComposioTool } from "@/lib/composio/execute";

export const dynamic = "force-dynamic";

type GmailProfile = {
  emailAddress?: string;
};

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

  try {
    await assertComposioAccountOwnedByUser(user.id, authId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }

  try {
    if (provider === "google") {
      const profile = await executeComposioTool<GmailProfile>({
        slug: "GMAIL_GET_PROFILE",
        userId: user.id,
        connectedAccountId: authId,
        arguments: { user_id: "me" },
      });
      const email = profile.emailAddress ?? "";
      if (!email) {
        return NextResponse.json({ error: "Gmail profile did not return an email address" }, { status: 502 });
      }
      return NextResponse.json({ mailboxes: [{ id: email, label: email, email }] });
    }

    const ms = await executeComposioTool<{
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
    }>({
      slug: "OUTLOOK_GET_PROFILE",
      userId: user.id,
      connectedAccountId: authId,
      arguments: {},
    });
    const email = ms.mail ?? ms.userPrincipalName ?? "";
    if (!email) {
      return NextResponse.json({ error: "Outlook profile did not return an email address" }, { status: 502 });
    }
    return NextResponse.json({
      mailboxes: [
        {
          id: email,
          label: ms.displayName ? `${ms.displayName} (${email})` : email,
          email,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not yet completed") || message.includes("INITIATED")) {
      return NextResponse.json({ error: "Authorization not yet completed" }, { status: 202 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
