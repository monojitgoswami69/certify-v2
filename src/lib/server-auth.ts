import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'certify_super_secret_jwt_key_2026';
export const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
export const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

if (process.env.NODE_ENV !== 'production') {
  if (!process.env.JWT_SECRET) {
    console.warn('[security] JWT_SECRET is not set; using an insecure default. Set it in production.');
  }
  if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD) {
    console.warn('[security] AUTH_USERNAME/AUTH_PASSWORD not set; using insecure defaults.');
  }
}

export interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

export function createJwtToken(username: string, rememberMe = true): string {
  const expiresIn = rememberMe ? '30d' : '24h';
  return jwt.sign({ username }, JWT_SECRET, { expiresIn, algorithm: 'HS256' });
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    if (!token || typeof token !== 'string') return null;
    return jwt.verify(token.trim(), JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch {
    return null;
  }
}

export function isAdminUser(username: string | null | undefined): boolean {
  if (!username || typeof username !== 'string') return false;
  const trimmed = username.trim();
  if (!trimmed) return false;

  // 1. Direct match with configured AUTH_USERNAME
  if (trimmed.toLowerCase() === AUTH_USERNAME.toLowerCase()) {
    return true;
  }

  // 2. Optional admin whitelist via environment variables
  const allowedAdminEnv =
    process.env.ADMIN_EMAILS ||
    process.env.ALLOWED_ADMIN_EMAILS ||
    process.env.ADMIN_USERS ||
    process.env.ADMIN_EMAIL;

  if (allowedAdminEnv) {
    const list = allowedAdminEnv
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(trimmed.toLowerCase());
  }

  // 3. By default in single-tenant setup, any user holding a valid JWT signed by JWT_SECRET is authorized
  return true;
}

export function getAuthUserFromRequest(request: Request): string | null {
  // 1. Authorization header: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const match = authHeader.match(/^bearer\s+(\S+)$/i);
    if (match) {
      const payload = verifyJwtToken(match[1]);
      if (payload?.username) return payload.username;
    }
  }

  // 2. Custom header fallbacks
  const xAuthToken = request.headers.get('x-auth-token') || request.headers.get('x-access-token');
  if (xAuthToken) {
    const payload = verifyJwtToken(xAuthToken.trim());
    if (payload?.username) return payload.username;
  }

  // 3. Cookie headers
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [rawKey, ...rawVal] = cookie.trim().split('=');
      const key = rawKey?.trim();
      const val = rawVal.join('=')?.trim();
      if (
        key === 'certify_auth_token' ||
        key === 'certify_session_token' ||
        key === 'auth_token' ||
        key === 'credify_auth_token' ||
        key === 'credify_session_token'
      ) {
        if (val) {
          try {
            const cleanToken = decodeURIComponent(val).replace(/^["']|["']$/g, '');
            const payload = verifyJwtToken(cleanToken);
            if (payload?.username) return payload.username;
          } catch {
            // Ignore malformed cookie and continue
          }
        }
      }
    }
  }

  return null;
}

export function getAdminUserFromRequest(request: Request): string | null {
  const username = getAuthUserFromRequest(request);
  if (!username) return null;
  if (!isAdminUser(username)) return null;
  return username;
}

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ detail: message }, { status: 401 });
}
