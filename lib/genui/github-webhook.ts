/**
 * GitHub webhook verification (HMAC-SHA256) and minimal payload helpers.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const GITHUB_SIG_PREFIX = "sha256=";

export function verifyGitHubSignature256(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.startsWith(GITHUB_SIG_PREFIX)
    ? signatureHeader.slice(GITHUB_SIG_PREFIX.length)
    : signatureHeader;
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseGitHubRepositoryFullName(rawBody: string): string | null {
  try {
    const j = JSON.parse(rawBody) as { repository?: { full_name?: string } };
    const fn = j.repository?.full_name;
    return typeof fn === "string" && fn.length > 0 ? fn : null;
  } catch {
    return null;
  }
}
