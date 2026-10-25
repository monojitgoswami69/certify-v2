/**
 * Minimal in-memory fixed-window rate limiter, keyed by IP.
 *
 * Deliberately simple: this app deploys as a single long-running Next.js
 * server, so a Map is accurate enough. If you ever scale to multiple
 * instances, swap this for a shared store (e.g. a Neon table or Upstash).
 */

import { env } from './env';

interface WindowState {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  certifyRateLimitMap?: Map<string, WindowState>;
};

const windows: Map<string, WindowState> =
  globalForRateLimit.certifyRateLimitMap ?? new Map<string, WindowState>();
globalForRateLimit.certifyRateLimitMap = windows;

// Periodic sweep so the map doesn't grow without bound under adversarial IPs.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, state] of windows) {
    if (state.resetAt <= now) windows.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const state = windows.get(key);
  if (!state || state.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (state.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((state.resetAt - now) / 1000) };
  }

  state.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * How many proxies in front of the app append trustworthy entries to
 * X-Forwarded-For. 0 = directly exposed (header fully client-controlled);
 * 1 = one trusted proxy (nginx/managed platform) appends the real client IP
 * as the LAST entry.
 *
 * X-Forwarded-For is `client, proxy1, proxy2, ...` — every hop APPENDS. The
 * client controls the beginning of the list, so only entries added by our own
 * trusted proxies (counting from the END) may be used for rate limiting.
 * Taking the first entry would let anyone bypass every IP rate limit
 * (including login brute-force) by rotating a spoofed header value.
 */
function trustedProxyCount(): number {
  return env.TRUSTED_PROXY_COUNT;
}

export function getClientIp(request: Request): string {
  const proxyCount = trustedProxyCount();
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd && proxyCount > 0) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean);
    // The hop `proxyCount` positions from the end was appended by our
    // outermost trusted proxy and is the address it received the request
    // from. Anything before it was supplied by untrusted parties.
    const trustedIndex = hops.length - proxyCount;
    if (trustedIndex >= 0) return hops[trustedIndex];
    // Fewer hops than expected: fall through to the platform-supplied header.
  }
  if (proxyCount > 0) {
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp.trim();
    return 'unknown-proxy';
  }
  // Directly exposed (no proxy): the socket address is not visible to route
  // handlers, and XFF/X-Real-IP are client-spoofable, so bucket everyone
  // together rather than trusting attacker-chosen keys.
  return 'direct';
}
