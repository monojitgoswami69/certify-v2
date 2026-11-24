import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { OAuth2Client } from 'google-auth-library';
import { createSessionToken, appendSessionCookie } from '../../../../lib/server-auth';
import { toPublicUser, upsertGoogleUser } from '../../../../lib/accounts';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { env, googleClientId } from '../../../../lib/env';
import { getPlatformPermissions, ensureSuperAdminRow } from '../../../../lib/platform-access';
import { log, requestIdOf } from '../../../../lib/logger';

const GOOGLE_CLIENT_ID = googleClientId();
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

interface GoogleIdentity {
  email: string;
  name: string;
  picture: string;
}

class GoogleVerificationUnavailable extends Error {}

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
  if (!infoRes.ok) {
    if (infoRes.status === 400 || infoRes.status === 401 || infoRes.status === 403) return null;
    throw new GoogleVerificationUnavailable();
  }
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
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }
  const { credential, accessToken } = body;
  const requestId = requestIdOf(request);
  const headers = { 'X-Request-Id': requestId };

  let identity: GoogleIdentity | null;
  try {
    if (typeof credential === 'string' && credential) {
      identity = await identityFromIdToken(credential);
    } else if (typeof accessToken === 'string' && accessToken) {
      identity = await identityFromAccessToken(accessToken);
    } else {
      return NextResponse.json({ detail: 'Google token or credential required' }, { status: 400, headers });
    }
  } catch (error) {
    // Google library error messages may include an entire token or its claims.
    // Use them only to classify the failure. Log fixed labels instead.
    const message = error instanceof Error ? error.message : '';
    const unavailable = error instanceof GoogleVerificationUnavailable || error instanceof TypeError ||
      message.startsWith('Failed to retrieve verification certificates:');
    const audienceMismatch = message.startsWith('Wrong recipient, payload audience');
    const reason = unavailable ? 'verification_unavailable' : audienceMismatch ? 'client_id_mismatch' : 'invalid_credential';
    log.warn('auth', 'Google credential verification failed', { requestId, reason });
    const detail = unavailable
      ? `Google verification is temporarily unavailable. Try again. Reference ${requestId}.`
      : audienceMismatch
        ? `Google sign-in is misconfigured for this deployment. Reference ${requestId}.`
        : `Google could not verify this sign-in credential. Try signing in again. Reference ${requestId}.`;
    return NextResponse.json({ detail }, { status: unavailable || audienceMismatch ? 503 : 401, headers });
  }

  if (!identity) {
    return NextResponse.json({ detail: 'Invalid Google credential' }, { status: 401, headers });
  }

  let stage = 'access_check';
  try {
    const permissions = await getPlatformPermissions(identity.email);
    if (!permissions) {
      return NextResponse.json(
        {
          detail:
            'This email has not been granted access yet. Ask your administrator to add it in the Admin console.',
        },
        { status: 403, headers }
      );
    }
    if (permissions.platformRole === 'super_admin') {
      stage = 'superadmin_setup';
      await ensureSuperAdminRow();
    }

    stage = 'account_update';
    const account = await upsertGoogleUser(identity);
    const user = toPublicUser(account, permissions);
    const rememberMe = body.rememberMe !== false;
    stage = 'session_creation';
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
    }, { headers });
    appendSessionCookie(response, token, rememberMe);
    return response;
  } catch (error) {
    log.error('auth', 'Certify could not complete Google sign-in', { requestId, stage }, error);
    return NextResponse.json(
      { detail: `Certify could not complete sign-in. Try again or share reference ${requestId} with the administrator.` },
      { status: 503, headers }
    );
  }
}
