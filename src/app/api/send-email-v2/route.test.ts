import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { getToken, reserve } = vi.hoisted(() => ({ getToken: vi.fn(), reserve: vi.fn() }));

vi.mock('../../../lib/accounts', () => ({
  getAuthenticatedUser: async () => ({
    userId: 'test-user', email: 'sender@example.test', name: 'Sender', canIssueCertificates: true,
  }),
}));
vi.mock('../../../lib/google-token-store', () => ({ getFreshAccessToken: getToken, gmailConfigured: () => true }));
vi.mock('../../../lib/mail-quota', () => ({ reserveMailSlot: reserve }));

function send() {
  const form = new FormData();
  form.set('recipient_email', 'recipient@example.test');
  form.set('sender_email', 'forged@example.test');
  form.set('email_subject', 'Certificate');
  form.set('pdf', new Blob(['test attachment']), 'certificate.pdf');
  return POST(new Request('http://localhost:3000/api/send-email-v2', {
    method: 'POST',
    headers: { 'X-Certify-Request': '1' },
    body: form,
  }));
}

describe('certificate email sender and quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue('test-token');
    reserve.mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the authenticated email in Gmail and the MIME From header', async () => {
    const gmail = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: 'test-message' }));
    vi.stubGlobal('fetch', gmail);
    expect((await send()).status).toBe(200);
    expect(reserve).toHaveBeenCalledWith('sender@example.test');
    expect(gmail).toHaveBeenCalledTimes(1);
    const [url, options] = gmail.mock.calls[0];
    expect(url).toContain('/users/sender%40example.test/messages/send');
    expect(String(options.body)).toContain('From: Sender <sender@example.test>');
    expect(String(options.body)).not.toContain('forged@example.test');
  });

  it('reports an unconfirmed outcome when the provider connection drops after submission', async () => {
    const gmail = vi.fn().mockRejectedValue(new Error('connection dropped'));
    vi.stubGlobal('fetch', gmail);
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 'unconfirmed' });
    expect(gmail).toHaveBeenCalledTimes(1);
  });

  it('reports a provider 5xx as unconfirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 'unconfirmed' });
  });

  it('uses the database retry interval without calling Gmail when over quota', async () => {
    reserve.mockResolvedValue({ allowed: false, retryAfter: 23 });
    const gmail = vi.fn();
    vi.stubGlobal('fetch', gmail);
    const response = await send();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('23');
    expect(gmail).not.toHaveBeenCalled();
  });

  it('rejects when access was revoked during the request', async () => {
    reserve.mockResolvedValue({ allowed: false, retryAfter: null });
    const gmail = vi.fn();
    vi.stubGlobal('fetch', gmail);
    const response = await send();
    expect(response.status).toBe(403);
    expect(response.headers.get('X-Certify-Issuance-Required')).toBe('1');
    expect(gmail).not.toHaveBeenCalled();
  });

  it('asks for a verified connection before reserving quota', async () => {
    getToken.mockResolvedValue(null);
    const response = await send();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 'reconnect_required' });
    expect(reserve).not.toHaveBeenCalled();
  });
});
