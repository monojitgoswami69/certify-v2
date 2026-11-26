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
  form.set('pdf', new Blob(['%PDF-1.4 test attachment']), 'certificate.pdf');
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

  it('loads oversized attachments via user-owned R2 staged_key and always deletes the staged blob', async () => {
    const { encryptStagedMail, packMailAttachments } = await import('../../../lib/mail-staging');
    const { createPresignedMailStagingUpload } = await import('../../../lib/r2-storage');
    process.env.R2_ACCOUNT_ID = 'acc123';
    process.env.R2_BUCKET = 'wecertify';
    process.env.R2_PUBLIC_BASE_URL = 'https://assets.wecertify.tech';
    process.env.R2_ACCESS_KEY_ID = 'key123';
    process.env.R2_SECRET_ACCESS_KEY = 'secret123';

    const packed = await packMailAttachments([
      { slot: 'png', blob: new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }) },
      { slot: 'pdf', blob: new Blob([Uint8Array.from([37, 80, 68, 70, 45])], { type: 'application/pdf' }) },
    ]);
    const { blob, key } = await encryptStagedMail(packed);
    const packedBytes = new Uint8Array(await blob.arrayBuffer());
    const staged = createPresignedMailStagingUpload({ userId: 'test-user', contentLength: packedBytes.byteLength });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('r2.cloudflarestorage.com') && (!init?.method || init.method === 'GET')) {
        return new Response(packedBytes, { status: 200, headers: { 'Content-Length': String(packedBytes.byteLength) } });
      }
      if (url.includes('r2.cloudflarestorage.com') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.includes('gmail.googleapis.com')) {
        return Response.json({ id: 'staged-msg-id' });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(new Request('http://localhost:3000/api/send-email-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
      body: JSON.stringify({
        certificate_id: certificateId,
        recipient_email: recipient,
        email_subject: 'Heavy Certificate',
        email_body_plain: 'Attached',
        filename: 'Alice_Cert',
        staged_key: staged.key,
        staged_encryption_key: key,
      }),
    }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain(`/${staged.key}`);
    expect(String(fetchMock.mock.calls[1][0])).toContain('gmail.googleapis.com');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('Alice_Cert.png');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('Alice_Cert.pdf');
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE');

    fetchMock.mockClear();
    packedBytes[packedBytes.length - 1] ^= 1;
    const tamperedRes = await POST(new Request('http://localhost:3000/api/send-email-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
      body: JSON.stringify({
        certificate_id: certificateId,
        recipient_email: recipient,
        staged_key: staged.key,
        staged_encryption_key: key,
      }),
    }));
    expect(tamperedRes.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');

    // Cross-user staged_key must be rejected cleanly with 400 before any R2 calls
    fetchMock.mockClear();
    const otherUser = createPresignedMailStagingUpload({ userId: 'other-user', contentLength: 64 });
    const badRes = await POST(new Request('http://localhost:3000/api/send-email-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Certify-Request': '1' },
      body: JSON.stringify({
        certificate_id: certificateId,
        recipient_email: recipient,
        email_subject: 'Steal attempt',
        staged_key: otherUser.key,
      }),
    }));
    expect(badRes.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
