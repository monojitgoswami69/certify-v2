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

export function createJwtToken(username: string): string {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function getAuthUserFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  const payload = verifyJwtToken(parts[1]);
  return payload ? payload.username : null;
}

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ detail: message }, { status: 401 });
}
