import { getComposioClient } from "@/lib/composio/client";

const versionCache = new Map<string, string>();

async function toolVersion(slug: string): Promise<string> {
  const cached = versionCache.get(slug);
  if (cached) return cached;
  const composio = getComposioClient();
  const tool = await composio.tools.getRawComposioToolBySlug(slug);
  const version = tool.version;
  if (!version) throw new Error(`No toolkit version for Composio tool ${slug}`);
  versionCache.set(slug, version);
  return version;
}

export async function executeComposioTool<T = unknown>({
  slug,
  userId,
  connectedAccountId,
  arguments: args = {},
}: {
  slug: string;
  userId: string;
  connectedAccountId: string;
  arguments?: Record<string, unknown>;
}): Promise<T> {
  const composio = getComposioClient();
  const version = await toolVersion(slug);
  const result = await composio.tools.execute(slug, {
    userId,
    connectedAccountId,
    version,
    arguments: args,
  });
  if (!result.successful) {
    const msg =
      typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error ?? "Composio tool failed");
    throw new Error(`${slug}: ${msg}`);
  }
  return result.data as T;
}
