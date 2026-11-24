import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { getToken, reserve, getTarget, claim, finish } = vi.hoisted(() => ({
  getToken: vi.fn(), reserve: vi.fn(), getTarget: vi.fn(), claim: vi.fn(), finish: vi.fn(),
}));

vi.mock('../../../lib/accounts', () => ({
  getAuthenticatedUser: async () => ({
    userId: 'test-user', email: 'sender@example.test', name: 'Sender', canIssueCertificates: true,
  }),
}));
vi.mock('../../../lib/google-token-store', () => ({ getFreshAccessToken: getToken, gmailConfigured: () => true }));
vi.mock('../../../lib/mail-quota', () => ({ reserveMailSlot: reserve }));
vi.mock('../../../lib/mail-delivery', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/mail-delivery')>(),
  getMailTarget: getTarget, claimMail: claim, finishMail: finish,
}));

const certificateId = 'bcafdce6-9e71-42cd-a40f-1d2e0b2bd20b';
const previousVersion = 'f1dba2a0-f2e9-453d-a133-a9c62251d0dc';
const recipient = 'recipient@example.test';

function send(options: { recipient?: string; version?: string; certificateId?: string } = {}) {
  const form = new FormData();
  form.set('certificate_id', options.certificateId ?? certificateId);
  form.set('recipient_email', options.recipient ?? recipient);
  if (options.version) form.set('resend_version', options.version);
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
    getTarget.mockResolvedValue({ status: 'pending', version: null, email: recipient });
    claim.mockResolvedValue('attempt');
    finish.mockResolvedValue(true);
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
    expect(getTarget).toHaveBeenCalledWith('test-user', certificateId, recipient);
    expect(finish).toHaveBeenCalledWith('test-user', certificateId, 'attempt', 'accepted', null, 'test-message', undefined);
  });

  it('reports an unconfirmed outcome when the provider connection drops after submission', async () => {
    const gmail = vi.fn().mockRejectedValue(new Error('connection dropped'));
    vi.stubGlobal('fetch', gmail);
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 'unconfirmed' });
    expect(gmail).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('test-user', certificateId, 'attempt', 'unknown', expect.any(String), undefined, undefined);
  });

  it('reports a provider 5xx as unconfirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 'unconfirmed' });
  });

  it('records a definite Gmail rejection as failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('status', 'unconfirmed');
    expect(finish).toHaveBeenCalledWith('test-user', certificateId, 'attempt', 'failed', expect.stringContaining('400'), undefined, undefined);
  });

  it('reports an uncertain result if Gmail accepted but the outcome could not be stored', async () => {
    finish.mockRejectedValueOnce(new Error('database unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'test-message' })));
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
    expect(finish).toHaveBeenCalledWith('test-user', certificateId, 'attempt', 'pending', expect.any(String), undefined, undefined);
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
    expect(claim).not.toHaveBeenCalled();
  });

  it('requires a valid certificate and rejects a recipient mismatch before claiming or taking quota', async () => {
    expect((await send({ certificateId: '' })).status).toBe(400);
    getTarget.mockResolvedValueOnce(undefined);
    expect((await send({ recipient: 'different@example.test' })).status).toBe(404);
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each(['sending', 'unknown', 'accepted'])('blocks automatic dispatch for %s records', async (status) => {
    getTarget.mockResolvedValueOnce({ status, email: recipient });
    const response = await send();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ deliveryStatus: status });
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rechecks a claim race without sending or taking quota for the losing request', async () => {
    claim.mockResolvedValueOnce(null);
    getTarget.mockResolvedValueOnce({ status: 'pending', email: recipient })
      .mockResolvedValueOnce({ status: 'sending', email: recipient });
    const response = await send();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ deliveryStatus: 'sending' });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('accepts intentional resend only with the current accepted version', async () => {
    getTarget.mockResolvedValue({ status: 'accepted', version: previousVersion, email: recipient });
    expect((await send({ version: certificateId })).status).toBe(409);
    expect(claim).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'new-message' })));
    expect((await send({ version: previousVersion })).status).toBe(200);
    expect(claim).toHaveBeenCalledWith('test-user', certificateId, recipient, previousVersion);
  });
});
