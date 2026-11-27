import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireIssuerMock, enqueueMock, getStatusMock, getOwnedMock, cancelMock, startAuthMock, completeAuthMock } = vi.hoisted(() => ({
  requireIssuerMock: vi.fn(),
  enqueueMock: vi.fn(),
  getStatusMock: vi.fn(),
  getOwnedMock: vi.fn(),
  cancelMock: vi.fn(),
  startAuthMock: vi.fn(),
  completeAuthMock: vi.fn(),
}));

vi.mock('../../../lib/issuer-auth', () => ({ requireIssuer: requireIssuerMock }));
vi.mock('../../../lib/mail-batches', () => {
  class MailBatchError extends Error {
    constructor(message: string, public readonly status = 400) {
      super(message);
    }
  }
  return {
    MailBatchError,
    WORKER_OAUTH_COOKIE: 'certify_worker_oauth',
    isBackgroundWorkerEnabled: () => process.env.ENABLE_BACKGROUND_MAIL_WORKER === 'true',
    enqueueMailBatch: enqueueMock,
    getEventBatchStatus: getStatusMock,
    getOwnedBatchSummary: getOwnedMock,
    cancelOwnedMailBatch: cancelMock,
    startBatchOAuthAuthorization: startAuthMock,
    completeBatchOAuthCallback: completeAuthMock,
  };
});

import { GET as listBatches, POST as enqueueBatch } from './route';
import { GET as getBatch } from './[batchId]/route';
import { POST as authorizeBatch } from './[batchId]/authorize/route';
import { GET as oauthCallback } from './oauth/callback/route';
import { POST as cancelBatch } from './[batchId]/cancel/route';
import { MailBatchError } from '../../../lib/mail-batches';
import { NextRequest } from 'next/server';

const issuerA = { userId: '11111111-1111-4111-8111-111111111111', email: 'alice@example.test', name: 'Alice', role: 'user', platformRole: 'user', canIssueCertificates: true };

describe('/api/mail-batches authorization & isolation', () => {
  const prevEnv = process.env.ENABLE_BACKGROUND_MAIL_WORKER;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_BACKGROUND_MAIL_WORKER = 'true';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    requireIssuerMock.mockResolvedValue({ user: issuerA });
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ENABLE_BACKGROUND_MAIL_WORKER;
    else process.env.ENABLE_BACKGROUND_MAIL_WORKER = prevEnv;
  });

  it('rejects missing CSRF header on POST /api/mail-batches, /authorize, and /cancel', async () => {
    const headers = { 'Content-Type': 'application/json', Cookie: 'certify_session=dummy' };
    expect((await enqueueBatch(new Request('http://localhost:3000/api/mail-batches', { method: 'POST', headers, body: '{}' }))).status).toBe(403);
    expect((await authorizeBatch(new Request('http://localhost:3000/api/mail-batches/id/authorize', { method: 'POST', headers }), { params: Promise.resolve({ batchId: 'id' }) })).status).toBe(403);
    expect((await cancelBatch(new Request('http://localhost:3000/api/mail-batches/id/cancel', { method: 'POST', headers }), { params: Promise.resolve({ batchId: 'id' }) })).status).toBe(403);
  });

  it('returns 404 when inspecting or cancelling another account’s batch', async () => {
    getOwnedMock.mockResolvedValueOnce(null);
    const getRes = await getBatch(new Request('http://localhost:3000/api/mail-batches/22222222-2222-4222-8222-222222222222'), {
      params: Promise.resolve({ batchId: '22222222-2222-4222-8222-222222222222' }),
    });
    expect(getRes.status).toBe(404);
    expect(getOwnedMock).toHaveBeenCalledWith(issuerA.userId, '22222222-2222-4222-8222-222222222222');

    cancelMock.mockRejectedValueOnce(new MailBatchError('Batch not found.', 404));
    const cancelRes = await cancelBatch(new Request('http://localhost:3000/api/mail-batches/22222222-2222-4222-8222-222222222222/cancel', {
      method: 'POST',
      headers: { 'X-Certify-Request': '1' },
    }), {
      params: Promise.resolve({ batchId: '22222222-2222-4222-8222-222222222222' }),
    });
    expect(cancelRes.status).toBe(404);
  });

  it('passes flag state accurately on GET /api/mail-batches and completes OAuth callback redirect cleanly', async () => {
    process.env.ENABLE_BACKGROUND_MAIL_WORKER = 'false';
    const disabled = await (await listBatches(new Request('http://localhost:3000/api/mail-batches'))).json();
    expect(disabled.enabled).toBe(false);

    completeAuthMock.mockResolvedValueOnce({
      batchId: '33333333-3333-4333-8333-333333333333',
      eventId: '44444444-4444-4444-8444-444444444444',
    });
    const cbRes = await oauthCallback(
      new NextRequest('http://localhost:3000/api/mail-batches/oauth/callback?state=st&code=cd', {
        headers: { cookie: 'certify_worker_oauth=bind' },
      })
    );
    expect(cbRes.status).toBe(307);
    const location = cbRes.headers.get('location') ?? '';
    expect(location).toContain('/mail-batches/callback?status=authorized');
    expect(location).not.toContain('code=');
    expect(location).not.toContain('state=');
  });
});
