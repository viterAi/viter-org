'use server';

import { redirect } from 'next/navigation';
import { getAuthClient } from '@/lib/supabase/server-auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export interface MagicLinkResult {
  ok: boolean;
  error?: string;
  email?: string;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Generate a 6-digit OTP and send it via Resend directly. This bypasses
 * Supabase's email-template editor (which silently fails to save) and the
 * Magic-Link-only default template that doesn't include {{ .Token }}.
 *
 * Flow:
 *   1. supabase.auth.admin.generateLink({ type: 'magiclink' }) — returns
 *      both `email_otp` (the 6-digit code) and `action_link` (the magic
 *      link). Does NOT send an email.
 *   2. Send our own email via Resend HTTP API with the OTP prominent.
 *   3. User pastes code → verifyOtp() in verifyEmailCode below.
 */
export async function sendMagicLink(email: string, _next?: string): Promise<MagicLinkResult> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned || !cleaned.includes('@')) return { ok: false, error: 'enter a valid email' };

  const allowlist = (process.env.AUTH_EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(cleaned)) {
    // Generic ack, same as success — no email enumeration.
    return { ok: true, email: cleaned };
  }

  // 1. Generate OTP via Supabase admin API (does NOT send email).
  const admin = getServiceRoleClient();
  const { data, error: genErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: cleaned,
  });
  if (genErr) return { ok: false, error: `generateLink: ${genErr.message}` };
  const otp = data.properties?.email_otp;
  if (!otp) return { ok: false, error: 'no OTP returned' };

  // 2. Send via Resend ourselves.
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY missing' };
  const sender = process.env.RESEND_FROM ?? 'vita <onboarding@resend.dev>';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#18181b;margin:0 0 8px">Sign in to vita</h2>
      <p style="color:#52525b;margin:0 0 24px">Your sign-in code:</p>
      <div style="font-family:'SF Mono',Menlo,monospace;font-size:32px;letter-spacing:0.4em;background:#f4f4f5;padding:16px 20px;border-radius:12px;display:inline-block;font-weight:600;color:#18181b">
        ${otp}
      </div>
      <p style="color:#71717a;font-size:13px;margin:24px 0 0">Paste it on the sign-in page. Expires in 1 hour. Single use.</p>
      <p style="color:#a1a1aa;font-size:12px;margin:32px 0 0">Didn't request this? Ignore — your account is safe.</p>
    </div>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: cleaned,
      subject: `Your vita sign-in code: ${otp}`,
      html,
      text: `Sign in to vita\n\nYour code: ${otp}\n\nExpires in 1 hour. Single use.`,
    }),
  });
  if (!resendRes.ok) {
    const body = await resendRes.text();
    return { ok: false, error: `resend ${resendRes.status}: ${body.slice(0, 200)}` };
  }

  return { ok: true, email: cleaned };
}

/**
 * Verify the 6-digit code from the email. This bypasses the magic-link
 * Gmail-prefetch problem (Gmail's anti-phishing scanner fetches the URL
 * before the user clicks, burning the OTP). The same email contains both
 * the link AND the 6-digit code; the code is single-use but only on
 * server-side submission.
 */
export async function verifyEmailCode(email: string, token: string, next?: string): Promise<VerifyResult> {
  const cleanedEmail = email.trim().toLowerCase();
  const cleanedToken = token.replace(/\D/g, '');
  if (!cleanedEmail || !cleanedToken) return { ok: false, error: 'email + code required' };
  if (cleanedToken.length !== 6) return { ok: false, error: 'enter the 6-digit code' };

  const sb = await getAuthClient();
  const { error } = await sb.auth.verifyOtp({
    email: cleanedEmail,
    token: cleanedToken,
    type: 'email',
  });
  if (error) return { ok: false, error: error.message };

  redirect(next && next.startsWith('/') ? next : '/');
}
