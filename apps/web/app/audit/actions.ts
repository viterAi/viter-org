"use server";

/**
 * /audit — per-user password auth (no Supabase, no email).
 *
 * env: AUDIT_USERS = "mordechai:pwd1,shaul:pwd2"
 *
 * Cookie scheme:
 *   audit_session = "<name>.<HMAC-SHA256(password, 'audit-session-v2:<name>')>"
 *
 * Deterministic. We know which named user is signed in. Rotating any
 * password invalidates that user's cookie only. The cookie embeds the
 * user's name so the report can show "Signed in as: shaul".
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "audit_session";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function parseUsers(): Map<string, string> {
  const raw = process.env.AUDIT_USERS ?? "";
  const users = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim().toLowerCase();
    const password = pair.slice(idx + 1).trim();
    if (name && password) users.set(name, password);
  }
  return users;
}

function tokenFor(name: string, password: string): string {
  return createHmac("sha256", password)
    .update(`audit-session-v2:${name}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function getAuditViewer(): Promise<string | null> {
  const users = parseUsers();
  if (users.size === 0) return null;
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  const dotIdx = cookie.indexOf(".");
  if (dotIdx < 0) return null;
  const name = cookie.slice(0, dotIdx);
  const presented = cookie.slice(dotIdx + 1);
  const password = users.get(name);
  if (!password) return null;
  return safeEqual(presented, tokenFor(name, password)) ? name : null;
}

export interface AuditLoginState {
  error?: string;
}

export async function submitAuditPassword(
  _prev: AuditLoginState,
  formData: FormData,
): Promise<AuditLoginState> {
  const password = String(formData.get("password") ?? "").trim();
  if (!password) return { error: "Enter the password." };
  const users = parseUsers();
  if (users.size === 0) return { error: "AUDIT_USERS not configured on the server." };

  let matched: string | null = null;
  for (const [name, expected] of users) {
    if (safeEqual(password, expected)) {
      matched = name;
      break;
    }
  }
  if (!matched) return { error: "Wrong password." };

  const store = await cookies();
  store.set(COOKIE_NAME, `${matched}.${tokenFor(matched, users.get(matched)!)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  redirect("/audit");
}

export async function signOutAudit(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  redirect("/audit");
}
