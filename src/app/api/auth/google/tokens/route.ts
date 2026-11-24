import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse, unauthorizedResponse } from '../../../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../../../lib/accounts';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import {
  clearGoogleCredentials,
  createGmailOAuthClient,
  gmailConfigured,
  GMAIL_SEND_SCOPE,
  hasGoogleConnection,
  storeGoogleCredentials,
} from '../../../../../lib/google-token-store';
import { env } from '../../../../../lib/env';
import { checkRateLimit } from '../../../../../lib/rate-limit';
import { log, requestIdOf } from '../../../../../lib/logger';

export async function GET(request: Request) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;
  const connected = await hasGoogleConnection(user);
  return NextResponse.json({ account: connected ? { email: user.email } : null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`gmail-connect:${user.userId}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ detail: 'Too many Gmail authorization attempts. Try again shortly.' }, {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec) },
    });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.code !== 'string' || !body.code || body.code.length > 4096) {
    return NextResponse.json({ detail: 'Authorization code is required' }, { status: 400 });
  }
  if (!gmailConfigured()) {
    return NextResponse.json({ detail: 'Gmail sending is not configured. Contact your administrator.' }, { status: 503 });
  }

  const configuredOrigin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  const origin = request.headers.get('origin') ?? configuredOrigin;
  if (origin !== configuredOrigin && (env.NODE_ENV === 'production' || origin !== new URL(request.url).origin)) {
    return NextResponse.json({ detail: 'Gmail authorization must come from the Certify origin' }, { status: 403 });
  }
  try {
    const { tokens } = await createGmailOAuthClient().getToken({ code: body.code, redirect_uri: origin });
    if (!tokens.access_token || !tokens.scope?.split(/\s+/).includes(GMAIL_SEND_SCOPE)) {
      return NextResponse.json({ detail: 'Allow Gmail sending when Google asks for permission.' }, { status: 403 });
    }

    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return NextResponse.json({ detail: 'Google could not verify the Gmail account. Try authorizing again.' }, { status: 502 });
    }
    const identity = await response.json();
    if (identity?.email_verified !== true || typeof identity.email !== 'string' ||
        identity.email.trim().toLowerCase() !== user.email) {
      return NextResponse.json({ detail: `Authorize Gmail with your Certify sign-in email, ${user.email}.` }, { status: 403 });
    }

    await storeGoogleCredentials(user, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
    });
    return NextResponse.json({ email: user.email });
  } catch {
    // Provider errors can include request headers, OAuth codes, or tokens.
    log.warn('gmail', 'Gmail authorization failed', { requestId: requestIdOf(request), userId: user.userId });
    return NextResponse.json({ detail: 'Gmail authorization failed. Try again shortly.' }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse();

  const token = await clearGoogleCredentials(user);
  if (token) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
  return NextResponse.json({ success: true });
}
