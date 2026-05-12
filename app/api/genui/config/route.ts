import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveTenantIdForUser } from "@/lib/genui/resolve-tenant";

export const dynamic = "force-dynamic";

function publicBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  return "";
}

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const tenantId = await resolveTenantIdForUser(user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  let base = publicBaseUrl();
  if (!base) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    if (host) base = `${proto}://${host}`;
    else base = "http://localhost:3000";
  }

  const webhookUrl = `${base}/api/integrations/github/genui`;
  const forwardSecretConfigured = Boolean(process.env.GENUI_ARCADE_FORWARD_SECRET);

  return NextResponse.json({
    tenantId,
    webhookUrl,
    forwardSecretConfigured,
  });
}
