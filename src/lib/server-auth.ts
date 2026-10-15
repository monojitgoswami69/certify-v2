import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_JWT_SECRET = 'certify_dev_only_insecure_jwt_secret';
const DEV_AUTH_USERNAME = 'admin';
const DEV_AUTH_PASSWORD = 'admin123';
const MIN_SECRET_LENGTH = 32;

let warnedInsecureDefaults = false;
function warnInsecureDefaultsOnce() {
  if (warnedInsecureDefaults) return;
  warnedInsecureDefaults = true;
  console.warn(
    '[security] JWT_SECRET / AUTH_USERNAME / AUTH_PASSWORD not fully configured; using insecure development defaults.'
  );
}

/**
 * Resolved lazily (not at module load) so `next build` works without secrets,
 * while production requests fail closed when the secret is missing or weak.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (IS_PRODUCTION) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  warnInsecureDefaultsOnce();
  return secret || DEV_JWT_SECRET;
}

/**
 * Password-login credentials. Returns null in production when they are unset
 * or left at the well-known defaults, which disables password login entirely.
 */
export function getPasswordCredentials(): { username: string; password: string } | null {
  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  if (username && password) {
    if (IS_PRODUCTION && password === DEV_AUTH_PASSWORD) return null;
    return { username, password };
  }
  if (IS_PRODUCTION) return null;
  warnInsecureDefaultsOnce();
  return { username: username || DEV_AUTH_USERNAME, password: password || DEV_AUTH_PASSWORD };
}

/** Comma-separated allowlist of Google account emails permitted to use the app. */
export function getAllowedEmails(): string[] {
  const raw =
    process.env.ADMIN_EMAILS ||
    process.env.ALLOWED_ADMIN_EMAILS ||
    process.env.ADMIN_USERS ||
    process.env.ADMIN_EMAIL ||
    '';
  return raw
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
}

export interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

export function createJwtToken(username: string, rememberMe = true): string {
  const expiresIn = rememberMe ? '30d' : '24h';
  return jwt.sign({ username }, getJwtSecret(), { expiresIn, algorithm: 'HS256' });
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const payload = jwt.verify(token.trim(), getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (typeof payload !== 'object' || typeof payload.username !== 'string') return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * The app is single-tenant: the configured password user plus any explicitly
 * allowlisted Google emails are authorized. Anyone else is rejected, even with
 * a correctly signed token (e.g. after being removed from the allowlist).
 */
export function isAdminUser(username: string | null | undefined): boolean {
  if (!username || typeof username !== 'string') return false;
  const normalized = username.trim().toLowerCase();
  if (!normalized) return false;

  const creds = getPasswordCredentials();
  if (creds && normalized === creds.username.toLowerCase()) return true;

  return getAllowedEmails().includes(normalized);
}

/**
 * Only the Authorization header is accepted. Cookie-based auth is deliberately
 * not supported, so cross-site requests can never ride an ambient session (CSRF).
 */
export function getAuthUserFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const match = authHeader.match(/^bearer\s+(\S+)$/i);
  if (!match) return null;

  const payload = verifyJwtToken(match[1]);
  if (!payload?.username || !isAdminUser(payload.username)) return null;
  return payload.username;
}

export function getAdminUserFromRequest(request: Request): string | null {
  return getAuthUserFromRequest(request);
}

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ detail: message }, { status: 401 });
}
