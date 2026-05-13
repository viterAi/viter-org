import { getComposioClient } from "@/lib/composio/client";

/** Ensure this connected account belongs to the signed-in Supabase user. */
export async function assertComposioAccountOwnedByUser(
  userId: string,
  connectedAccountId: string,
): Promise<void> {
  const composio = getComposioClient();
  const list = await composio.connectedAccounts.list({
    userIds: [userId],
    statuses: ["ACTIVE", "INITIATED", "INITIALIZING"],
  });
  const owned = (list.items ?? []).some((a) => a.id === connectedAccountId);
  if (!owned) {
    throw new Error("This connection belongs to another user or no longer exists. Connect again.");
  }
}
