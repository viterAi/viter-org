import { getComposioClient } from "@/lib/composio/client";

type OAuthVal = {
  access_token?: string;
  accessToken?: string;
};

export type ComposioTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "inactive" | "missing" | "masked" };

function readRawToken(val: OAuthVal | undefined): string | null {
  const token = val?.access_token ?? val?.accessToken;
  if (typeof token !== "string" || token.length === 0) return null;
  if (token.includes("...") || token === "REDACTED") return null;
  return token;
}

/** @deprecated Composio always returns REDACTED on connected-account GET; use executeComposioTool instead. */
export async function getComposioAccessToken(
  connectedAccountId: string,
): Promise<string | null> {
  const result = await getComposioAccessTokenDetailed(connectedAccountId);
  return result.ok ? result.token : null;
}

export async function getComposioAccessTokenDetailed(
  connectedAccountId: string,
): Promise<ComposioTokenResult> {
  const composio = getComposioClient();
  const account = await composio.connectedAccounts.get(connectedAccountId);
  if (account.status !== "ACTIVE") return { ok: false, reason: "inactive" };

  const val = account.state?.val as OAuthVal | undefined;
  const token = readRawToken(val);
  if (!token) {
    const raw = val?.access_token ?? val?.accessToken;
    if (typeof raw === "string" && (raw.includes("...") || raw === "REDACTED")) {
      return { ok: false, reason: "masked" };
    }
    return { ok: false, reason: "missing" };
  }
  return { ok: true, token };
}
