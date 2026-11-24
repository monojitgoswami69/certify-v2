import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { verify, role, upsertUser, makeSession, warn, logError } = vi.hoisted(() => ({
  verify: vi.fn(),
  role: vi.fn(),
  upsertUser: vi.fn(),
  makeSession: vi.fn(),
  warn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verify;
  },
}));
vi.mock('../../../../lib/env', () => ({
  env: { DATABASE_URL: 'test-db', TRUSTED_PROXY_COUNT: 0 },
  googleClientId: () => 'certify-test-client',
}));
vi.mock('../../../../lib/server-auth', () => ({
  mutationAllowed: () => true,
  forbiddenCsrfResponse: () => new Response(null, { status: 403 }),
  createSessionToken: makeSession,
  appendSessionCookie: (response: Response, token: string) => {
    response.headers.set('Set-Cookie', `certify_session=${token}; HttpOnly`);
  },
}));
vi.mock('../../../../lib/platform-access', () => ({
  getPlatformPermissions: role,
  ensureSuperAdminRow: vi.fn(),
}));
vi.mock('../../../../lib/accounts', () => ({
  upsertGoogleUser: upsertUser,
  toPublicUser: (user: object, permissions: object) => ({ ...user, ...permissions }),
}));
vi.mock('../../../../lib/logger', () => ({
  log: { warn, error: logError },
  requestIdOf: () => 'google-login-reference',
}));

function signIn() {
  return POST(new Request('https://certify.example.test/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
    body: JSON.stringify({ credential: 'fake-google-token' }),
  }));
}

describe('Google sign-in failure stages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verify.mockReset().mockResolvedValue({
      getPayload: () => ({ email: 'issuer@example.test', email_verified: true }),
    });
    role.mockReset().mockResolvedValue({ platformRole: 'user', canIssueCertificates: false });
    upsertUser.mockReset().mockResolvedValue({ userId: 'issuer', email: 'issuer@example.test' });
    makeSession.mockReset().mockReturnValue('session');
  });

  it('creates a session for a verified, allowed Google user', async () => {
    const response = await signIn();
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ platformRole: 'user', canIssueCertificates: false });
    expect(response.headers.get('set-cookie')).toContain('certify_session=session');
    expect(verify).toHaveBeenCalledWith({ idToken: 'fake-google-token', audience: 'certify-test-client' });
  });

  it('rejects a bad credential and excludes the token from output and logs', async () => {
    verify.mockRejectedValue(new Error('Invalid token signature: fake-google-token'));
    const response = await signIn();
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('fake-google-token');
    expect(warn).toHaveBeenCalledWith('auth', 'Google credential verification failed', {
      requestId: 'google-login-reference', reason: 'invalid_credential',
    });
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it.each([
    ['Wrong recipient, payload audience != requiredAudience', 'client_id_mismatch'],
    ['Failed to retrieve verification certificates: upstream unavailable', 'verification_unavailable'],
  ])('identifies a verifier configuration or availability problem', async (message, reason) => {
    verify.mockRejectedValue(new Error(message));
    const response = await signIn();
    expect(response.status).toBe(503);
    expect(response.headers.get('x-request-id')).toBe('google-login-reference');
    expect(warn).toHaveBeenCalledWith('auth', 'Google credential verification failed', {
      requestId: 'google-login-reference', reason,
    });
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it('keeps allowlist refusals distinct from authentication failures', async () => {
    role.mockResolvedValue(null);
    expect((await signIn()).status).toBe(403);
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it('reports a post-verification account failure as a service failure', async () => {
    const failure = new Error('database unavailable');
    upsertUser.mockRejectedValue(failure);
    const response = await signIn();
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('google-login-reference');
    expect(logError).toHaveBeenCalledWith('auth', 'Certify could not complete Google sign-in', {
      requestId: 'google-login-reference', stage: 'account_update',
    }, failure);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
