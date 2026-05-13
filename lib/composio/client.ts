import { Composio } from "@composio/core";

let client: Composio | null = null;

export function getComposioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error("COMPOSIO_API_KEY not configured");
  }
  if (!client) {
    client = new Composio({ apiKey });
  }
  return client;
}

export function hasComposio(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}
