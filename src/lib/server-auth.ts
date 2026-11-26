import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import { env, isProduction } from './env';

const DEV_JWT_SECRET = 'certify_dev_only_insecure_jwt_secret';
const DEV_AUTH_PASSWORD = 'admin123';
const MIN_SECRET_LENGTH = 32;

let warnedInsecureDefaults = false;
function warnInsecureDefaultsOnce() {
  if (warnedInsecureDefaults) return;
  warnedInsecureDefaults = true;
  console.warn(
    '[security] JWT_SECRET or AUTH_PASSWORD is not fully configured; using an insecure development default.'
  );
}

/**
 * Resolved lazily (not at module load) so `next build` works without secrets,
 * while production requests fail closed when the secret is missing or weak.
 */
function getJwtSecret(): string {
  const secret = env.JWT_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (isProduction()) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  warnInsecureDefaultsOnce();
  return secret || DEV_JWT_SECRET;
}

/** The one address that is the admin. Compared case-insensitively. */
export function getAdminEmail(): string | null {
  const email = env.ADMIN_EMAIL;
  if (!email || !email.includes('@')) return null;
  return email;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const admin = getAdminEmail();
  if (!admin || !email) return false;
  return email.trim().toLowerCase() === admin;
}

/**
 * Password sign-in is only for the admin address. Returns null when it is not
 * configured, and in production when the password is still the well-known default.
 */
export function getPasswordCredentials(): { email: string; password: string } | null {
  const email = getAdminEmail();
  if (!email) return null;

  const password = env.AUTH_PASSWORD;
  if (password) {
    if (isProduction() && password === DEV_AUTH_PASSWORD) return null;
    return { email, password };
  }
  if (isProduction()) return null;
  warnInsecureDefaultsOnce();
  return { email, password: DEV_AUTH_PASSWORD };
}

export interface SessionClaims {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  name: string;
}

export function createSessionToken(claims: SessionClaims, rememberMe = true): string {
  // 7d for "remember me": a stolen localStorage token stays dangerous for its
  // whole life, so the long-lived window is kept deliberately short. Logout
  // revokes server-side regardless (see users.sessions_valid_after).
  const expiresIn = rememberMe ? '7d' : '24h';
  return jwt.sign(
    { userId: claims.userId, email: claims.email, role: claims.role, name: claims.name, issuedAtMs: Date.now() },
    getJwtSecret(),
    { expiresIn, algorithm: 'HS256' }
  );
}

export interface VerifiedSession {
  userId: string;
  /** Seconds since epoch when the token was issued (jwt `iat`). */
  issuedAt: number | null;
  issuedAtMs: number | null;
}

/** Verifies the signature and returns the account id + issue time. Profile data is loaded from the database, not trusted from the token. */
export function readSession(token: string): VerifiedSession | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const payload = jwt.verify(token.trim(), getJwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null || typeof payload.userId !== 'string') return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.userId)) {
      return null;
    }
    const issuedAt = typeof payload.iat === 'number' ? payload.iat : null;
    const issuedAtMs = typeof payload.issuedAtMs === 'number' ? payload.issuedAtMs : issuedAt === null ? null : issuedAt * 1000;
    return { userId: payload.userId, issuedAt, issuedAtMs };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session transport: HttpOnly cookie (primary) + Authorization bearer
// (legacy/compat). The cookie is HttpOnly so no script — however it got onto
// the page — can read the token; the browser attaches it to same-origin
// requests automatically. SameSite=Lax plus the X-Certify-Request mutation
// guard below make cross-site request forgery impossible.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'certify_session';
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // matches the "remember me" token life

function cookieAttributes(rememberMe: boolean): string {
  // Secure is omitted in development: Safari rejects Secure cookies over
  // http://localhost, and dev has no cross-network exposure to protect against.
  const secure = isProduction() ? '; Secure' : '';
  const maxAge = rememberMe ? `; Max-Age=${SESSION_COOKIE_MAX_AGE}` : '';
  return `; Path=/; SameSite=Lax; HttpOnly${secure}${maxAge}`;
}

export function appendSessionCookie(response: NextResponse, token: string, rememberMe: boolean): void {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}${cookieAttributes(rememberMe)}`
  );
}

export function clearSessionCookie(response: NextResponse): void {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`
  );
}

function readSessionCookie(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

/** Uses the current browser session before consulting legacy bearer storage. */
export function getSessionFromRequest(request: Request): VerifiedSession | null {
  const cookieToken = readSessionCookie(request);
  const browserSession = cookieToken ? readSession(cookieToken) : null;
  if (browserSession) return browserSession;

  const match = request.headers.get('authorization')?.match(/^bearer\s+(\S+)$/i);
  return match ? readSession(match[1]) : null;
}

/**
 * CSRF guard for state-changing requests. Browser callers send the
 * `X-Certify-Request` custom header, which cross-site pages cannot add
 * without a CORS preflight this app never grants. Bearer-authenticated
 * callers carry no ambient credential, so they are inherently CSRF-safe.
 */
export function mutationAllowed(request: Request): boolean {
  if (request.headers.get('x-certify-request') === '1') return true;
  return !readSessionCookie(request) && Boolean(request.headers.get('authorization')?.match(/^bearer\s+\S+$/i));
}

export function forbiddenCsrfResponse(): NextResponse {
  return NextResponse.json({ detail: 'Missing anti-CSRF request header' }, { status: 403 });
}

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ detail: message }, { status: 401 });
}
