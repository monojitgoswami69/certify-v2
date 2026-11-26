import { NextRequest, NextResponse } from 'next/server';
import { env } from './lib/env';
import { verificationMaintenancePage } from './lib/verification-maintenance';

/**
 * Lightweight request proxy scoped strictly to `/verify/*` maintenance gating.
 * All other page routes are prerendered statically and receive their static
 * security headers / CSP directly from `next.config.mjs`.
 */
export function proxy(request: NextRequest) {
  if (/^\/verify\/[^/]+\/?$/.test(request.nextUrl.pathname) && env.VERIFY_MAINTENANCE) {
    return verificationMaintenancePage();
  }
  const response = NextResponse.next();
  response.headers.set('x-request-id', crypto.randomUUID());
  return response;
}

export const config = {
  matcher: '/verify/:path*',
};
