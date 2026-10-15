import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createJwtToken, getPasswordCredentials } from '../../../../lib/server-auth';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';

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
  // Per-IP limit, plus a global cap that still holds if X-Forwarded-For is spoofed.
  const ipRate = checkRateLimit(`login:${getClientIp(request)}`, 10, 60_000);
  if (!ipRate.allowed) return tooManyAttempts(ipRate.retryAfterSec);
  const globalRate = checkRateLimit('login:global', 30, 60_000);
  if (!globalRate.allowed) return tooManyAttempts(globalRate.retryAfterSec);

  let body: { username?: unknown; password?: unknown; rememberMe?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  const creds = getPasswordCredentials();
  if (!creds) {
    return NextResponse.json(
      { detail: 'Password sign-in is not configured on this server' },
      { status: 503 }
    );
  }

  const { username, password, rememberMe = true } = body;
  const userMatch = typeof username === 'string' && safeCompare(username, creds.username);
  const passMatch = typeof password === 'string' && safeCompare(password, creds.password);

  if (!userMatch || !passMatch) {
    return NextResponse.json({ detail: 'Invalid username or password' }, { status: 401 });
  }

  try {
    const token = createJwtToken(creds.username, Boolean(rememberMe));
    return NextResponse.json({
      token,
      username: creds.username,
      message: 'Login successful',
    });
  } catch (error) {
    console.error('[Login error]:', error);
    return NextResponse.json({ detail: 'Sign-in is temporarily unavailable' }, { status: 500 });
  }
}
