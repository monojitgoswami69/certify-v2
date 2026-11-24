import { NextRequest, NextResponse } from 'next/server';
import { env } from './lib/env';
import { verificationMaintenancePage } from './lib/verification-maintenance';

/**
 * Per-request nonce-based Content Security Policy.
 *
 * Next.js reads the CSP header from the forwarded request headers and applies
 * the nonce to its own bootstrap/hydration inline scripts, which lets us ship
 * a policy WITHOUT 'unsafe-inline' in script-src: inline scripts are only
 * executable when they carry this request's nonce, so an HTML-injection bug
 * anywhere can no longer execute attacker script.
 *
 * Notes:
 * - 'strict-dynamic' is deliberately NOT used: the Google Identity Services
 *   script is injected as a plain host-sourced <script> without a nonce, so
 *   host allowlisting must keep working.
 * - style-src keeps 'unsafe-inline' (Tailwind + Next inline styles).
 * - API routes and static assets are excluded; they need no CSP.
 */

const DEV = process.env.NODE_ENV === 'development';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  if (/^\/verify\/[^/]+\/?$/.test(request.nextUrl.pathname) && env.VERIFY_MAINTENANCE) {
    return verificationMaintenancePage(nonce);
  }
  const requestId = crypto.randomUUID();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com${DEV ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    'connect-src \'self\' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com',
    'frame-src https://accounts.google.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(DEV ? [] : ['upgrade-insecure-requests']),
  ]
    .join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
