export type ComposioProvider = "github" | "google" | "microsoft";

const AUTH_CONFIG_ENV: Record<ComposioProvider, string> = {
  github: "COMPOSIO_AUTH_CONFIG_GITHUB",
  google: "COMPOSIO_AUTH_CONFIG_GMAIL",
  microsoft: "COMPOSIO_AUTH_CONFIG_OUTLOOK",
};

export function getComposioAuthConfigId(provider: ComposioProvider): string {
  const envKey = AUTH_CONFIG_ENV[provider];
  const id = process.env[envKey]?.trim();
  if (!id) {
    throw new Error(
      `${envKey} not configured. Create a Composio auth config (managed OAuth) for this toolkit and paste the ac_… id.`,
    );
  }
  return id;
}

export function appBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}
