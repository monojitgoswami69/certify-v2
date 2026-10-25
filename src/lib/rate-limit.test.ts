import { describe, it, expect } from 'vitest';
import { checkRateLimit, getClientIp } from './rate-limit';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/api/login', { headers });
}

describe('checkRateLimit', () => {
  it('allows up to the limit inside one window then blocks with a retry hint', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toEqual({ allowed: true, retryAfterSec: 0 });
    }
    const blocked = checkRateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('isolates keys', () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(a, 3, 60_000);
    expect(checkRateLimit(b, 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit(a, 3, 60_000).allowed).toBe(false);
  });

  it('starts a fresh window after expiry', () => {
    const key = `exp:${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 1);
    return new Promise((resolve) => setTimeout(resolve, 15)).then(() => {
      expect(checkRateLimit(key, 3, 1).allowed).toBe(true);
    });
  });
});

describe('getClientIp', () => {
  it('uses the LAST hop with one trusted proxy, ignoring client-supplied prefix', () => {
    const spoofed = makeRequest({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    expect(getClientIp(spoofed)).toBe('203.0.113.9');
  });

  it('counts trusted hops from the end', () => {
    const previous = process.env.TRUSTED_PROXY_COUNT;
    process.env.TRUSTED_PROXY_COUNT = '2';
    try {
      const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9, 203.0.113.9' });
      // Two trusted proxies appended the last two hops; 9.9.9.9 is what our
      // outermost proxy saw as the immediate client.
      expect(getClientIp(req)).toBe('9.9.9.9');
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_COUNT;
      else process.env.TRUSTED_PROXY_COUNT = previous;
    }
  });

  it('falls back to x-real-ip when the XFF hop count is shorter than expected', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.7' });
    expect(getClientIp(req)).toBe('203.0.113.9');

    const noXff = makeRequest({ 'x-real-ip': '198.51.100.7' });
    expect(getClientIp(noXff)).toBe('198.51.100.7');
  });

  it('ignores spoofable headers entirely when directly exposed (TRUSTED_PROXY_COUNT=0)', () => {
    const previous = process.env.TRUSTED_PROXY_COUNT;
    process.env.TRUSTED_PROXY_COUNT = '0';
    try {
      const spoofed = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' });
      expect(getClientIp(spoofed)).toBe('direct');
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_COUNT;
      else process.env.TRUSTED_PROXY_COUNT = previous;
    }
  });
});
