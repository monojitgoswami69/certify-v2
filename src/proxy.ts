import { NextRequest, NextResponse } from 'next/server';
import { env } from './lib/env';
import { verificationMaintenancePage } from './lib/verification-maintenance';
import { appContentSecurityPolicy } from './lib/content-security-policy.mjs';

/**
 * Bind Next.js bootstrap scripts to the response on signed-in and verification pages.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  if (/^\/verify\/[^/]+\/?$/.test(request.nextUrl.pathname) && env.VERIFY_MAINTENANCE) {
    return verificationMaintenancePage(nonce);
  }
  const policy = appContentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/verify/:path*', '/admin/:path*', '/editor/:path*', '/dashboard/:path*', '/login/:path*', '/mail-batches/:path*'],
};
