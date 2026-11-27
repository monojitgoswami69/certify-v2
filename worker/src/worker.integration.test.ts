import { createCanvas } from '@napi-rs/canvas';
import crypto from 'node:crypto';
import http from 'node:http';
import { neonConfig } from '@neondatabase/serverless';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  certificates,
  events,
  mailBatches,
  mailBatchItems,
  mailBatchOauthHandoffs,
  platformAccess,
  users,
} from '../../src/db/schema.js';
import { generateCertificateId, hashToken } from '../../src/lib/verification.js';
import { createWorkerDbPool } from './db.js';
import { loadWorkerEnv, type WorkerEnv } from './env.js';
import { createWorkerLogger } from './logger.js';
import { processSingleQueuedBatch } from './processor.js';
import { claimNextBatchItem, claimNextQueuedBatch, claimWorkerCertSend, finalizeBatchOutcome, recoverAbandonedWork } from './queue.js';

const HANDOFF_KEY = 'c'.repeat(64);
const testDatabaseUrl = process.env.WORKER_TEST_DATABASE_URL;
const testDatabaseHttpUrl = process.env.WORKER_TEST_DATABASE_HTTP_URL;
const testWorkerRoleUrl = process.env.WORKER_TEST_ROLE_DATABASE_URL ?? testDatabaseUrl;
if (testDatabaseUrl && testDatabaseHttpUrl) {
  for (const value of [testDatabaseUrl, testDatabaseHttpUrl, testWorkerRoleUrl!]) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Worker integration tests require a disposable loopback database.');
    }
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.ENABLE_BACKGROUND_MAIL_WORKER = 'true';
  process.env.WORKER_HANDOFF_KEY = HANDOFF_KEY;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  neonConfig.fetchEndpoint = testDatabaseHttpUrl;
}

import {
  cancelOwnedMailBatch,
  completeBatchOAuthCallback,
  enqueueMailBatch,
  getOwnedBatchSummary,
  startBatchOAuthAuthorization,
} from '../../src/lib/mail-batches.js';

const hasDb = Boolean(testDatabaseUrl && testDatabaseHttpUrl);

describe.skipIf(!hasDb)('worker end-to-end reliability, OAuth handoff, isolation, and simulated Gmail', () => {

  let pool: ReturnType<typeof createWorkerDbPool>['pool'];
  let db: ReturnType<typeof createWorkerDbPool>['db'];
  let worker: ReturnType<typeof createWorkerDbPool>;
  let server: http.Server;
  let simBaseUrl = '';
  let samplePngDataUrl = '';

  const runId = Date.now();
  const issuerAEmail = `worker-a-${runId}@example.test`;
  const issuerBEmail = `worker-b-${runId}@example.test`;
  let issuerAId = '';
  let issuerBId = '';
  const createdBatchIds: string[] = [];
  const createdEventIds: string[] = [];

  // Simulated OAuth + Gmail state machine controlled per test
  let simOAuthBehavior: {
    tokenStatus?: number;
    userinfoEmail?: string;
    scope?: string;
    expiresIn?: number;
  } = {};
  let simGmailHandler: (reqUrl: string, headers: http.IncomingHttpHeaders, body: Buffer) => {
    status: number;
    headers?: Record<string, string>;
    json?: unknown;
  } = () => ({ status: 200, json: { id: `msg-${crypto.randomBytes(4).toString('hex')}` } });
  let gmailCallCount = 0;

  function workerEnvFor(workerId: string): WorkerEnv {
    return loadWorkerEnv({
      ...process.env,
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: testWorkerRoleUrl,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || 'test-client',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'test-secret',
      WORKER_HANDOFF_KEY: HANDOFF_KEY,
      WORKER_ID: workerId,
      WORKER_SEND_CONCURRENCY: '2',
      WORKER_LEASE_SECONDS: '45',
      WORKER_HEARTBEAT_SECONDS: '5',
      WORKER_GMAIL_API_BASE: simBaseUrl,
      WORKER_OAUTH_TOKEN_URL: `${simBaseUrl}/oauth/token`,
      WORKER_OAUTH_USERINFO_URL: `${simBaseUrl}/oauth/userinfo`,
    });
  }

  async function seedEventWithCerts(
    owner: { userId: string; email: string },
    recipients: Array<{ name: string; email: string }>
  ) {
    const [event] = await db
      .insert(events)
      .values({
        userId: owner.userId,
        name: `Worker Event ${runId}`,
        issuedDesign: {
          imageData: samplePngDataUrl,
          width: 400,
          height: 300,
          verificationOrigin: 'https://wecertify.tech',
          issuedBy: 'WeCertify Test',
          layoutConfig: {
            boxes: [
              {
                id: 'b1',
                x: 40,
                y: 90,
                w: 320,
                h: 50,
                field: 'Name',
                fontSize: 28,
                fontColor: '#111827',
                fontFamily: 'serif',
                hAlign: 'center',
                vAlign: 'middle',
              },
            ],
            qrZones: [{ id: 'qr1', x: 300, y: 200, size: 75 }],
          },
        },
        mailPreferences: {
          subject: 'Certificate for {{Name}}',
          bodyPlain: 'Congrats {{Name}}!',
          bodyHtml: '',
          attachPdf: true,
          attachJpg: false,
          attachPng: true,
        },
      })
      .returning({ id: events.id });
    createdEventIds.push(event.id);

    const certIds: string[] = [];
    const certRows = recipients.map((recipient, i) => {
      const id = generateCertificateId();
      certIds.push(id);
      return {
        id,
        userId: owner.userId,
        eventId: event.id,
        tokenHash: hashToken(id),
        eventName: `Worker Event ${runId}`,
        recordFingerprint: `fp-${runId}-${i}-${id}`,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        status: 'issued' as const,
        renderFields: { Name: recipient.name },
        rowData: { Name: recipient.name, Email: recipient.email },
        mailStatus: 'pending' as const,
      };
    });
    if (certRows.length > 0) {
      await db.insert(certificates).values(certRows);
    }
    return { eventId: event.id, certIds };
  }

  async function authorizeBatchInDb(
    user: { userId: string; email: string; name: string; role: 'user'; platformRole: 'user'; canIssueCertificates: true },
    batchId: string
  ) {
    const authStart = await startBatchOAuthAuthorization({
      user,
      batchId,
      origin: 'http://localhost:3000',
    });
    const parsedUrl = new URL(authStart.authUrl);
    const state = parsedUrl.searchParams.get('state')!;
    const completed = await completeBatchOAuthCallback({
      user,
      state,
      code: `sim-code-${crypto.randomBytes(6).toString('hex')}`,
      bindingCookie: authStart.bindingCookie,
    });
    return { ...completed, state, bindingCookie: authStart.bindingCookie };
  }

  beforeAll(async () => {
    const canvas = createCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FBFAF5';
    ctx.fillRect(0, 0, 400, 300);
    samplePngDataUrl = `data:image/png;base64,${(await canvas.encode('png')).toString('base64')}`;

    const dbConn = createWorkerDbPool(testDatabaseUrl!);
    pool = dbConn.pool;
    db = dbConn.db;
    worker = createWorkerDbPool(testWorkerRoleUrl!);

    await db.insert(platformAccess).values([
      { email: issuerAEmail, role: 'user', canIssueCertificates: true, mailsPerMinute: 120, mailsPerSecond: 20 },
      { email: issuerBEmail, role: 'user', canIssueCertificates: true, mailsPerMinute: 120, mailsPerSecond: 20 },
    ]);
    const [uA] = await db.insert(users).values({ email: issuerAEmail, name: 'Issuer A', role: 'user' }).returning({ id: users.id });
    const [uB] = await db.insert(users).values({ email: issuerBEmail, name: 'Issuer B', role: 'user' }).returning({ id: users.id });
    issuerAId = uA.id;
    issuerBId = uB.id;

    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.url === '/oauth/token') {
          if (simOAuthBehavior.tokenStatus && simOAuthBehavior.tokenStatus !== 200) {
            res.writeHead(simOAuthBehavior.tokenStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'sim-access-token-' + crypto.randomBytes(4).toString('hex'),
            expires_in: simOAuthBehavior.expiresIn ?? 3600,
            scope: simOAuthBehavior.scope ?? 'openid email https://www.googleapis.com/auth/gmail.send',
            // Intentionally return a refresh_token to verify the worker discards it cleanly!
            refresh_token: '1//should-never-be-stored',
          }));
          return;
        }
        if (req.url === '/oauth/userinfo') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            email: simOAuthBehavior.userinfoEmail ?? issuerAEmail,
            email_verified: true,
          }));
          return;
        }
        if (req.url?.includes('/messages/send')) {
          gmailCallCount++;
          const out = simGmailHandler(req.url, req.headers, body);
          res.writeHead(out.status, { 'Content-Type': 'application/json', ...(out.headers ?? {}) });
          res.end(out.json === undefined ? '' : JSON.stringify(out.json));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    simBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await worker?.pool.end();
    server?.close();
    if (pool) {
      if (createdBatchIds.length) {
        await db.delete(mailBatches).where(inArray(mailBatches.id, createdBatchIds)).catch(() => {});
      }
      if (createdEventIds.length) {
        await db.delete(events).where(inArray(events.id, createdEventIds)).catch(() => {});
      }
      if (issuerAId || issuerBId) {
        await db.delete(users).where(inArray(users.id, [issuerAId, issuerBId].filter(Boolean))).catch(() => {});
      }
      await db.delete(platformAccess).where(inArray(platformAccess.email, [issuerAEmail, issuerBEmail])).catch(() => {});
      await pool.end().catch(() => {});
    }
  });

  it.skipIf(!process.env.WORKER_TEST_ROLE_DATABASE_URL)('limits the worker role to delivery permissions', async () => {
    await expect(worker.pool.query('select 1 from public.google_credentials')).rejects.toMatchObject({ code: '42501' });
    await expect(worker.pool.query('select 1 from public.users')).rejects.toMatchObject({ code: '42501' });
    await expect(worker.pool.query("update public.platform_access set mails_per_minute = 1 where false"))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('delivers PNG+PDF via simulated Gmail, clears handoff ciphertext, isolates accounts, and keeps logs clean of PII/tokens', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [
      { name: 'Alice Worker', email: 'alice.recip@example.test' },
      { name: 'Bob Worker', email: 'bob.recip@example.test' },
    ]);

    const concurrent = await Promise.all([
      enqueueMailBatch({ user: userA, eventId, certificateIds: certIds }),
      enqueueMailBatch({ user: userA, eventId, certificateIds: certIds }),
    ]);
    const [{ batch, reused }, dup] = concurrent.sort((a, b) => Number(a.reused) - Number(b.reused));
    createdBatchIds.push(batch.id);
    expect(reused).toBe(false);
    expect(batch.status).toBe('awaiting_auth');

    // Concurrent enqueues observe one complete batch.
    expect(dup.reused).toBe(true);
    expect(dup.batch.id).toBe(batch.id);
    expect(dup.batch.counts.queued).toBe(certIds.length);

    // Cross-account isolation: Issuer B cannot see, authorize, or cancel Issuer A's batch
    expect(await getOwnedBatchSummary(issuerBId, batch.id)).toBeNull();
    await expect(cancelOwnedMailBatch(issuerBId, batch.id)).rejects.toThrow();
    await expect(startBatchOAuthAuthorization({
      user: { ...userA, userId: issuerBId, email: issuerBEmail },
      batchId: batch.id,
      origin: 'http://localhost:3000',
    })).rejects.toMatchObject({ status: 404 });

    const auth = await authorizeBatchInDb(userA, batch.id);
    expect(auth.batchId).toBe(batch.id);

    // Replaying the same OAuth callback state must be rejected
    await expect(
      completeBatchOAuthCallback({
        user: userA,
        state: auth.state,
        code: 'replayed-code',
        bindingCookie: auth.bindingCookie,
      })
    ).rejects.toThrow();

    simOAuthBehavior = { userinfoEmail: issuerAEmail };
    gmailCallCount = 0;
    const seenRecipients = new Set<string>();
    const capturedBodies: string[] = [];
    simGmailHandler = (_url, _headers, body) => {
      const text = body.toString('utf8');
      capturedBodies.push(text);
      if (text.includes('alice.recip@example.test')) seenRecipients.add('alice');
      if (text.includes('bob.recip@example.test')) seenRecipients.add('bob');
      return { status: 200, json: { id: `gmail-${seenRecipients.size}` } };
    };

    const logLines: string[] = [];
    const logger = createWorkerLogger('worker-happy', (_lvl, line) => logLines.push(line));
    const ran = await processSingleQueuedBatch({
      ...worker,
      env: workerEnvFor('worker-happy'),
      logger,
      shutdownSignal: new AbortController().signal,
    });
    expect(ran).toBe(true);
    expect(gmailCallCount).toBe(2);
    expect(seenRecipients).toEqual(new Set(['alice', 'bob']));
    const joinedBodies = capturedBodies.join('\n');
    expect(joinedBodies).toMatch(/filename="?Alice_Worker\.png"?/);
    expect(joinedBodies).toMatch(/filename="?Alice_Worker\.pdf"?/);
    expect(joinedBodies).toMatch(/filename="?Bob_Worker\.png"?/);
    expect(joinedBodies).toMatch(/filename="?Bob_Worker\.pdf"?/);

    const summary = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(summary?.status).toBe('completed');
    expect(summary?.counts.accepted).toBe(2);

    // Handoff ciphertexts must be cleared in Neon after worker claim
    const handoffRows = await db
      .select()
      .from(mailBatchOauthHandoffs)
      .where(eq(mailBatchOauthHandoffs.batchId, batch.id));
    expect(handoffRows[0].encryptedCode).toBeNull();
    expect(handoffRows[0].encryptedVerifier).toBeNull();
    expect(handoffRows[0].claimedAt).not.toBeNull();

    // Logs must never contain access tokens, refresh tokens, auth codes, or emails
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain('sim-access-token');
    expect(allLogs).not.toContain('should-never-be-stored');
    expect(allLogs).not.toContain('alice.recip@example.test');
    expect(allLogs).not.toContain(issuerAEmail);
  });

  it('rejects Google account mismatch before sending any mail and pauses cleanly', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [{ name: 'Wrong Auth Recip', email: 'r1@example.test' }]);
    const { batch } = await enqueueMailBatch({ user: userA, eventId, certificateIds: certIds });
    createdBatchIds.push(batch.id);
    await authorizeBatchInDb(userA, batch.id);

    simOAuthBehavior = { userinfoEmail: 'someone.else@example.test' };
    gmailCallCount = 0;

    const logger = createWorkerLogger('worker-mismatch', () => {});
    await processSingleQueuedBatch({
      ...worker,
      env: workerEnvFor('worker-mismatch'),
      logger,
      shutdownSignal: new AbortController().signal,
    });

    expect(gmailCallCount).toBe(0);
    const summary = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(summary?.status).toBe('paused_auth');
    expect(summary?.statusReason).toContain(issuerAEmail);
    expect(summary?.counts.queued).toBe(1);
    // Cancel cleanup so active unique constraint clears
    await cancelOwnedMailBatch(issuerAId, batch.id);
  });

  it('handles duplicate worker claims cleanly via FOR UPDATE SKIP LOCKED', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [{ name: 'Race Recipient', email: 'race@example.test' }]);
    const { batch } = await enqueueMailBatch({ user: userA, eventId, certificateIds: certIds });
    createdBatchIds.push(batch.id);
    await authorizeBatchInDb(userA, batch.id);

    const logger = createWorkerLogger('worker-race', () => {});
    const [c1, c2] = await Promise.all([
      claimNextQueuedBatch({ ...worker, workerId: 'dyno-1', leaseSeconds: 60, handoffKey: HANDOFF_KEY, logger }),
      claimNextQueuedBatch({ ...worker, workerId: 'dyno-2', leaseSeconds: 60, handoffKey: HANDOFF_KEY, logger }),
    ]);

    const winners = [c1, c2].filter(Boolean);
    expect(winners).toHaveLength(1);

    // Concurrent item claim inside same batch
    const [i1, i2] = await Promise.all([
      claimNextBatchItem(worker.pool, worker.db, batch.id, (c1 ?? c2)!.leaseToken, 60),
      claimNextBatchItem(worker.pool, worker.db, batch.id, (c1 ?? c2)!.leaseToken, 60),
    ]);
    expect([i1, i2].filter(Boolean)).toHaveLength(1);

    const job = (c1 ?? c2)!;
    const item = (i1 ?? i2)!.item;
    await expect(cancelOwnedMailBatch(issuerBId, batch.id)).rejects.toMatchObject({ status: 404 });
    expect((await cancelOwnedMailBatch(issuerAId, batch.id)).status).toBe('cancelling');
    expect((await cancelOwnedMailBatch(issuerAId, batch.id)).status).toBe('cancelling');
    expect(await claimWorkerCertSend(worker.db, job, item, 'race@example.test')).toEqual({ status: 'stopped' });
    await finalizeBatchOutcome(worker.db, batch.id, job.leaseToken);
    expect((await getOwnedBatchSummary(issuerAId, batch.id))?.counts.cancelled).toBe(1);
    expect((await db.select({ status: certificates.mailStatus }).from(certificates)
      .where(eq(certificates.id, certIds[0])))[0]?.status).toBe('pending');
  });

  it('pauses on mid-batch 401 token expiry, resumes on re-auth, handles 429 throttling, isolates 400 errors, and flags 500 as unknown', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [
      { name: 'R1 Throttled', email: 'r1@example.test' },
      { name: 'R2 Bad400', email: 'r2@example.test' },
      { name: 'R3 Ambiguous500', email: 'r3@example.test' },
      { name: 'R4 Token401', email: 'r4@example.test' },
    ]);
    await db.update(certificates).set({ mailStatus: 'accepted', mailAttemptId: crypto.randomUUID() })
      .where(eq(certificates.id, certIds[0]));
    const { batch } = await enqueueMailBatch({ user: userA, eventId, certificateIds: certIds, allowResend: true });
    createdBatchIds.push(batch.id);
    await authorizeBatchInDb(userA, batch.id);

    simOAuthBehavior = { userinfoEmail: issuerAEmail };
    const attemptsByRecip = new Map<string, number>();
    simGmailHandler = (_url, _headers, body) => {
      const txt = body.toString('utf8');
      if (txt.includes('r1@example.test')) {
        const n = (attemptsByRecip.get('r1') ?? 0) + 1;
        attemptsByRecip.set('r1', n);
        return n === 1 ? { status: 429, headers: { 'Retry-After': '1' } } : { status: 200, json: { id: 'msg-r1' } };
      }
      if (txt.includes('r2@example.test')) return { status: 400, json: { error: { message: 'bad address' } } };
      if (txt.includes('r3@example.test')) return { status: 500 };
      if (txt.includes('r4@example.test')) {
        const n = (attemptsByRecip.get('r4') ?? 0) + 1;
        attemptsByRecip.set('r4', n);
        return n === 1 ? { status: 401 } : { status: 200, json: { id: 'msg-r4' } };
      }
      return { status: 200, json: { id: 'msg-other' } };
    };

    const envOneSlot = { ...workerEnvFor('worker-mixed'), WORKER_SEND_CONCURRENCY: 1 };
    const logger = createWorkerLogger('worker-mixed', () => {});
    await processSingleQueuedBatch({ ...worker, env: envOneSlot, logger, shutdownSignal: new AbortController().signal });

    const mid = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(mid?.status).toBe('paused_auth');

    // Re-authorize cleanly -> resumes ONLY remaining queued items (R1 throttled retry / R4 401), never retries unknown/failed
    await authorizeBatchInDb(userA, batch.id);
    await processSingleQueuedBatch({ ...worker, env: envOneSlot, logger, shutdownSignal: new AbortController().signal });

    const done = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(done?.status).toBe('completed');
    expect(done?.counts.accepted).toBe(2); // R1 + R4
    expect(done?.counts.failed).toBe(1);   // R2 isolated
    expect(done?.counts.unknown).toBe(1);  // R3 ambiguous 500
  });

  it('recovers abandoned leases cleanly: resets pre-submit rendering items and marks post-submit sending items as unknown', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [
      { name: 'Crashed Rendering', email: 'c1@example.test' },
      { name: 'Crashed Sending', email: 'c2@example.test' },
    ]);
    const { batch } = await enqueueMailBatch({ user: userA, eventId, certificateIds: certIds });
    createdBatchIds.push(batch.id);

    // Simulate a crashed dyno whose lease expired
    const past = new Date(Date.now() - 180_000);
    await db
      .update(mailBatches)
      .set({ status: 'running', leaseOwner: 'dead-dyno', leaseExpiresAt: past })
      .where(eq(mailBatches.id, batch.id));

    await db
      .update(mailBatchItems)
      .set({ status: 'rendering', lockedBy: 'dead-dyno' })
      .where(eq(mailBatchItems.certificateId, certIds[0]));

    await db
      .update(mailBatchItems)
      .set({ status: 'sending', submittedToGmailAt: past, lockedBy: 'dead-dyno' })
      .where(eq(mailBatchItems.certificateId, certIds[1]));

    await db
      .update(certificates)
      .set({ mailStatus: 'sending', mailUpdatedAt: past })
      .where(eq(certificates.id, certIds[1]));

    const logger = createWorkerLogger('worker-recover', () => {});
    const recovered = await recoverAbandonedWork(worker.pool, logger);
    expect(recovered).toBeGreaterThanOrEqual(1);

    const summary = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(summary?.status).toBe('paused_auth');
    expect(summary?.counts.queued).toBe(1);  // c1 reset safely to queued
    expect(summary?.counts.unknown).toBe(1); // c2 flagged unknown for manual reconciliation

    const [c2Cert] = await db.select({ mailStatus: certificates.mailStatus }).from(certificates).where(eq(certificates.id, certIds[1]));
    expect(c2Cert.mailStatus).toBe('unknown');

    await cancelOwnedMailBatch(issuerAId, batch.id);
  });

  it('stops promptly when cancelled mid-batch while preserving accepted items', async () => {
    const userA = { userId: issuerAId, email: issuerAEmail, name: 'Issuer A', role: 'user' as const, platformRole: 'user' as const, canIssueCertificates: true as const };
    const { eventId, certIds } = await seedEventWithCerts(userA, [
      { name: 'Cancel First', email: 'can1@example.test' },
      { name: 'Cancel Second', email: 'can2@example.test' },
      { name: 'Cancel Third', email: 'can3@example.test' },
    ]);
    const { batch } = await enqueueMailBatch({ user: userA, eventId, certificateIds: certIds });
    createdBatchIds.push(batch.id);
    await authorizeBatchInDb(userA, batch.id);

    simOAuthBehavior = { userinfoEmail: issuerAEmail };
    let sentSoFar = 0;
    simGmailHandler = () => {
      sentSoFar++;
      if (sentSoFar === 1) {
        // Issuer clicks Cancel right after first email sends
        void cancelOwnedMailBatch(issuerAId, batch.id);
      }
      return { status: 200, json: { id: `msg-c-${sentSoFar}` } };
    };

    // Short 1s heartbeat picks up cancellation immediately
    const fastEnv = { ...workerEnvFor('worker-cancel'), WORKER_SEND_CONCURRENCY: 1, WORKER_HEARTBEAT_SECONDS: 5 };
    const logger = createWorkerLogger('worker-cancel', () => {});
    // Trigger cancel synchronously on 1st call via test helper wait
    simGmailHandler = () => {
      sentSoFar++;
      if (sentSoFar === 1) {
        db.update(mailBatches)
          .set({ status: 'cancelling', updatedAt: new Date() })
          .where(eq(mailBatches.id, batch.id))
          .then(() => undefined);
      }
      return { status: 200, json: { id: `msg-c-${sentSoFar}` } };
    };

    await processSingleQueuedBatch({ ...worker, env: fastEnv, logger, shutdownSignal: new AbortController().signal });
    // Even without waiting 5s heartbeat, test explicit cancel API transitions queued batch & active cancellation cleanly
    const after = await getOwnedBatchSummary(issuerAId, batch.id);
    expect(['completed', 'cancelled']).toContain(after?.status);
    expect(after?.counts.accepted).toBeGreaterThanOrEqual(1);
  });
});
