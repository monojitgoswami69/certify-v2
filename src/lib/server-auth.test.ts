import { describe, it, expect } from 'vitest';
import {
  createSessionToken,
  getSessionFromRequest,
  mutationAllowed,
  readSession,
} from './server-auth';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeToken(): string {
  return createSessionToken({ userId: USER_ID, email: 'a@b.c', role: 'user', name: 'A' }, true);
}

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://app.example/api/x', { headers });
}

describe('session transport', () => {
  it('reads a session from the Authorization bearer header', () => {
    const token = makeToken();
    const session = getSessionFromRequest(requestWith({ Authorization: `Bearer ${token}` }));
    expect(session?.userId).toBe(USER_ID);
    expect(session?.issuedAt).toBeGreaterThan(0);
  });

  it('reads a session from the HttpOnly session cookie', () => {
    const token = makeToken();
    const session = getSessionFromRequest(
      requestWith({ cookie: `other=x; certify_session=${token}; more=y` })
    );
    expect(session?.userId).toBe(USER_ID);
  });

  it('keeps the browser account when a legacy bearer identifies a different account', () => {
    const legacyToken = createSessionToken({
      userId: '00000000-0000-4000-8000-000000000002',
      email: 'legacy@example.test',
      role: 'user',
      name: 'Legacy',
    });
    const session = getSessionFromRequest(requestWith({
      Authorization: `Bearer ${legacyToken}`,
      cookie: `certify_session=${makeToken()}`,
    }));
    expect(session?.userId).toBe(USER_ID);
  });

  it('returns null with no credential, a garbage token, or a foreign cookie', () => {
    expect(getSessionFromRequest(requestWith({}))).toBeNull();
    expect(getSessionFromRequest(requestWith({ Authorization: 'Bearer not.a.jwt' }))).toBeNull();
    expect(getSessionFromRequest(requestWith({ cookie: 'session=abc' }))).toBeNull();
    expect(readSession('')).toBeNull();
  });
});

describe('mutationAllowed (CSRF guard)', () => {
  it('allows requests carrying the custom anti-CSRF header', () => {
    expect(mutationAllowed(requestWith({ 'x-certify-request': '1' }))).toBe(true);
  });

  it('allows bearer-authenticated callers (no ambient credential to forge)', () => {
    expect(mutationAllowed(requestWith({ Authorization: 'Bearer abc' }))).toBe(true);
  });

  it('rejects plain cross-site requests with no marker', () => {
    expect(mutationAllowed(requestWith({ cookie: 'certify_session=stolen-by-csrf' }))).toBe(false);
    expect(mutationAllowed(requestWith({
      cookie: 'certify_session=valid-cookie',
      Authorization: 'Bearer invalid-token',
    }))).toBe(false);
    expect(mutationAllowed(requestWith({}))).toBe(false);
    expect(mutationAllowed(requestWith({ 'x-certify-request': '0' }))).toBe(false);
  });
});
