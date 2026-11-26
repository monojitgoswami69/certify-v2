import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { getToken, store } = vi.hoisted(() => ({ getToken: vi.fn(), store: vi.fn() }));

vi.mock('../../../../../lib/accounts', () => ({
  getAuthenticatedUser: async () => ({ userId: crypto.randomUUID(), email: 'sender@example.test', canIssueCertificates: true }),
}));
vi.mock('../../../../../lib/google-token-store', () => ({
  createGmailOAuthClient: () => ({ getToken }),
  gmailConfigured: () => true,
  GMAIL_SEND_SCOPE: 'https://www.googleapis.com/auth/gmail.send',
  storeGoogleCredentials: store,
}));

function exchange(origin?: string) {
  return POST(new Request('http://localhost:3000/api/auth/google/tokens', {
    method: 'POST',
    headers: { 'X-Certify-Request': '1', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ code: 'test-code' }),
  }));
}

describe('Gmail authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue({
      tokens: {
        access_token: 'test-access',
        refresh_token: 'test-refresh',
        scope: 'openid https://www.googleapis.com/auth/gmail.send',
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('exchanges codes using either public WeCertify origin during the domain move', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://certify-v2.mgbuilds.in');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      email: 'sender@example.test', email_verified: true,
    })));
    expect((await exchange('https://wecertify.tech')).status).toBe(200);
    expect(getToken).toHaveBeenCalledWith({ code: 'test-code', redirect_uri: 'https://wecertify.tech' });
    expect((await exchange('https://unapproved.example.test')).status).toBe(403);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    { email: 'other@example.test', email_verified: true },
    { email: 'sender@example.test', email_verified: false },
    { email: 'sender@example.test' },
  ])('rejects an unverified or different mailbox', async (identity) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(identity)));
    expect((await exchange()).status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });

  it('fails closed when Google does not return identity data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    expect((await exchange()).status).toBe(502);
    expect(store).not.toHaveBeenCalled();
  });

  it('requires that Gmail send permission was actually granted', async () => {
    getToken.mockResolvedValueOnce({ tokens: { access_token: 'test-access', scope: 'openid email' } });
    expect((await exchange()).status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });

  it('stores the matching grant and only exposes the verified sender email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      email: 'Sender@Example.Test',
      email_verified: true,
    })));
    const response = await exchange();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'sender@example.test' });
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'sender@example.test' }),
      expect.objectContaining({ accessToken: 'test-access', refreshToken: 'test-refresh' })
    );
  });
});
