import { getComposioClient } from "@/lib/composio/client";

type OAuthVal = {
  access_token?: string;
  accessToken?: string;
};

/** Load a bearer token for a Composio connected account (`ca_…`). */
export async function getComposioAccessToken(
  connectedAccountId: string,
): Promise<string | null> {
  const composio = getComposioClient();
  const account = await composio.connectedAccounts.get(connectedAccountId);
  if (account.status !== "ACTIVE") return null;

  const val = account.state?.val as OAuthVal | undefined;
  const token = val?.access_token ?? val?.accessToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}
