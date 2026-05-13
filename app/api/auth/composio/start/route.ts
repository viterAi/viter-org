import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getComposioClient, hasComposio } from "@/lib/composio/client";
import { appBaseUrl, getComposioAuthConfigId, type ComposioProvider } from "@/lib/composio/config";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set<ComposioProvider>(["github", "google", "microsoft"]);

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!hasComposio()) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not configured" }, { status: 500 });
  }

  let body: { provider?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = (body.provider ?? "") as ComposioProvider;
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `Unknown provider. Supported: ${[...PROVIDERS].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const composio = getComposioClient();
    const authConfigId = getComposioAuthConfigId(provider);
    const callbackUrl = `${appBaseUrl(req)}/auth/composio/done`;

    const existing = await composio.connectedAccounts.list({
      userIds: [user.id],
      authConfigIds: [authConfigId],
      statuses: ["ACTIVE"],
    });
    const first = existing.items?.[0];
    if (first?.id) {
      return NextResponse.json({ status: "already_authorized", auth_id: first.id });
    }

    const connectionRequest = await composio.connectedAccounts.link(user.id, authConfigId, {
      callbackUrl,
      allowMultiple: true,
    });

    if (!connectionRequest.redirectUrl) {
      return NextResponse.json({ error: "Composio did not return a redirect URL" }, { status: 500 });
    }

    return NextResponse.json({
      status: "auth_required",
      auth_url: connectionRequest.redirectUrl,
      auth_id: connectionRequest.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
