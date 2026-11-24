import { log, requestIdOf } from '../../../../lib/logger';
import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { createHash, timingSafeEqual } from 'crypto';
import {
  createSessionToken,
  getPasswordCredentials,
  appendSessionCookie,
} from '../../../../lib/server-auth';
import { ensureAdminUser, toPublicUser } from '../../../../lib/accounts';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { env } from '../../../../lib/env';
import { ensureSuperAdminRow, getPlatformPermissions } from '../../../../lib/platform-access';

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function tooManyAttempts(retryAfterSec: number) {
  return NextResponse.json(
    { detail: 'Too many login attempts. Please wait a minute and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  );
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const ipRate = checkRateLimit(`login:${getClientIp(request)}`, 10, 60_000);
  if (!ipRate.allowed) return tooManyAttempts(ipRate.retryAfterSec);

  let body: { email?: unknown; username?: unknown; password?: unknown; rememberMe?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }
  const creds = getPasswordCredentials();
  if (!creds || !env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Password sign-in is not configured on this server' },
      { status: 503 }
    );
  }

  const submitted = typeof body.email === 'string' ? body.email : typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const emailMatch = safeCompare(submitted.trim().toLowerCase(), creds.email);
  const passMatch = safeCompare(password, creds.password);

  if (!emailMatch || !passMatch) {
    // Only failures consume the shared global budget, so an attacker hammering
    // garbage credentials can never lock the real admin out of sign-in.
    const globalFailRate = checkRateLimit('login:global-fail', 30, 60_000);
    if (!globalFailRate.allowed) return tooManyAttempts(globalFailRate.retryAfterSec);
    return NextResponse.json({ detail: 'Invalid email or password' }, { status: 401 });
  }

  try {
    const account = await ensureAdminUser();
    await ensureSuperAdminRow();
    const permissions = await getPlatformPermissions(account.email);
    if (!permissions) throw new Error('Superadmin permissions are unavailable');
    const user = toPublicUser(account, permissions);
    const rememberMe = Boolean(body.rememberMe ?? true);
    const token = createSessionToken(
      { userId: user.userId, email: user.email, role: user.role, name: user.name },
      rememberMe
    );
    const response = NextResponse.json({ token, user, message: 'Login successful' });
    appendSessionCookie(response, token, rememberMe);
    return response;
  } catch (error) {
    log.warn('auth', 'Sign-in failed', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Sign-in is temporarily unavailable' }, { status: 500 });
  }
}
