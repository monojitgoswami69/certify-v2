/**
 * Minimal in-memory fixed-window rate limiter, keyed by IP.
 *
 * Deliberately simple: this app deploys as a single long-running Next.js
 * server, so a Map is accurate enough. If you ever scale to multiple
 * instances, swap this for a shared store (e.g. a Neon table or Upstash).
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  credifyRateLimitMap?: Map<string, WindowState>;
};

const windows: Map<string, WindowState> =
  globalForRateLimit.credifyRateLimitMap ?? new Map<string, WindowState>();
globalForRateLimit.credifyRateLimitMap = windows;

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

/** First hop of x-forwarded-for, or a fallback marker when no proxy header. */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
