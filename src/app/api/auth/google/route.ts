import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { OAuth2Client } from 'google-auth-library';
import { createSessionToken, appendSessionCookie } from '../../../../lib/server-auth';
import { toPublicUser, upsertGoogleUser } from '../../../../lib/accounts';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { env, googleClientId } from '../../../../lib/env';
import { getPlatformRole, ensureSuperAdminRow } from '../../../../lib/platform-access';

const GOOGLE_CLIENT_ID = googleClientId();
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
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
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

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Sign-in is not configured' }, { status: 503 });
  }

  let body: { credential?: unknown; accessToken?: unknown; rememberMe?: unknown };
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

    // Allowlist gate: only admin-added emails can access the platform.
    const platformRole = await getPlatformRole(identity.email);
    if (!platformRole) {
      return NextResponse.json(
        {
          detail:
            'This email has not been granted access yet. Ask your administrator to add it in the Admin console.',
        },
        { status: 403 }
      );
    }
    if (platformRole === 'super_admin') {
      await ensureSuperAdminRow();
    }

    const account = await upsertGoogleUser(identity);
    const user = toPublicUser(account);
    const rememberMe = body.rememberMe !== false;
    const token = createSessionToken(
      {
        userId: user.userId,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      rememberMe
    );

    const response = NextResponse.json({
      token,
      user,
      message: 'Google Sign-In successful',
    });
    appendSessionCookie(response, token, rememberMe);
    return response;
  } catch (error) {
    console.error('[Google OAuth Error]:', error);
    return NextResponse.json({ detail: 'Google authentication failed' }, { status: 401 });
  }
}
