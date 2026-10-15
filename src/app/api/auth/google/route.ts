import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { createJwtToken, getAllowedEmails } from '../../../../lib/server-auth';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

interface GoogleIdentity {
  email: string;
  name: string;
  picture: string;
}

async function identityFromIdToken(credential: string): Promise<GoogleIdentity | null> {
  const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email || payload.email_verified !== true) return null;
  return {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || '',
  };
}

/**
 * Access tokens are bearer credentials from *any* OAuth client, so the token's
 * audience must be checked against our client ID before trusting its identity.
 */
async function identityFromAccessToken(accessToken: string): Promise<GoogleIdentity | null> {
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!infoRes.ok) return null;
  const info = await infoRes.json();
  if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) return null;
  if (!info.email || String(info.email_verified) !== 'true') return null;

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = userRes.ok ? await userRes.json() : {};
  return {
    email: info.email,
    name: user.name || info.email.split('@')[0],
    picture: user.picture || '',
  };
}

export async function POST(request: Request) {
  const rate = checkRateLimit(`google-login:${getClientIp(request)}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many sign-in attempts. Please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ detail: 'Google sign-in is not configured' }, { status: 503 });
  }

  const allowedEmails = getAllowedEmails();
  if (allowedEmails.length === 0) {
    return NextResponse.json(
      { detail: 'Google sign-in is disabled: no ADMIN_EMAILS allowlist is configured' },
      { status: 403 }
    );
  }

  let body: { credential?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }
  const { credential, accessToken } = body;

  try {
    let identity: GoogleIdentity | null = null;
    if (typeof credential === 'string' && credential) {
      identity = await identityFromIdToken(credential);
    } else if (typeof accessToken === 'string' && accessToken) {
      identity = await identityFromAccessToken(accessToken);
    } else {
      return NextResponse.json({ detail: 'Google token or credential required' }, { status: 400 });
    }

    if (!identity) {
      return NextResponse.json({ detail: 'Invalid Google credential' }, { status: 401 });
    }
    if (!allowedEmails.includes(identity.email.toLowerCase())) {
      return NextResponse.json({ detail: 'This Google account is not authorized' }, { status: 403 });
    }

    const token = createJwtToken(identity.email);

    return NextResponse.json({
      token,
      username: identity.name,
      email: identity.email,
      picture: identity.picture,
      accessToken: typeof accessToken === 'string' ? accessToken : null,
      message: 'Google Sign-In successful',
    });
  } catch (error) {
    console.error('[Google OAuth Error]:', error);
    return NextResponse.json({ detail: 'Google authentication failed' }, { status: 401 });
  }
}
