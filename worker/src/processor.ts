import type pg from 'pg';
import { sanitizeAttachmentBaseName, type MailAttachment } from '../../src/lib/gmail-mime.js';
import { canClaimMail } from '../../src/lib/mail-delivery.js';
import { MAX_MAIL_ATTACHMENT_BYTES } from '../../src/lib/mail-staging.js';
import { replaceTemplateVariables } from '../../src/lib/utils.js';
import type { WorkerDb } from './db.js';
import type { WorkerEnv } from './env.js';
import { currentRssMb, type WorkerLogger } from './logger.js';
import { MailSizeError, stageGmailMessage } from './mail-file.js';
import { exchangeBatchOAuthCode, InMemoryBatchToken } from './oauth.js';
import {
  claimNextBatchItem,
  claimNextQueuedBatch,
  claimWorkerCertSend,
  earliestQueuedRetryDelayMs,
  finalizeBatchOutcome,
  finishWorkerCertSend,
  markItemTerminal,
  recordBatchAuthorized,
  recoverAbandonedWork,
  renewBatchLease,
  requeueItem,
  reserveWorkerMailSlot,
  type ClaimedBatchJob,
} from './queue.js';
import { CertificateAttachmentSizeError, WorkerRenderContext } from './renderer.js';

const MAX_GMAIL_THROTTLE_BACKOFF_SEC = 60;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function parseRetryAfterSeconds(header: string | null, fallbackSeconds: number): number {
  if (!header) return fallbackSeconds;
  if (/^\d+$/.test(header.trim())) return Math.max(1, Math.min(2_147_483_647, Number(header.trim())));
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(1, Math.min(2_147_483_647, Math.ceil((dateMs - Date.now()) / 1000)));
  }
  return fallbackSeconds;
}

export async function processSingleQueuedBatch(params: {
  pool: pg.Pool;
  db: WorkerDb;
  env: WorkerEnv;
  logger: WorkerLogger;
  shutdownSignal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { pool, db, env, logger, shutdownSignal } = params;
  const fetchFn = params.fetchImpl ?? fetch;

  await recoverAbandonedWork(pool, logger);
  if (shutdownSignal.aborted) return false;

  const claimed = await claimNextQueuedBatch({
    pool,
    db,
    workerId: env.resolvedWorkerId,
    leaseSeconds: env.WORKER_LEASE_SECONDS,
    handoffKey: env.WORKER_HANDOFF_KEY,
    logger,
  });

  if (!claimed) return false;

  await runClaimedBatch({ pool, db, env, logger, claimed, shutdownSignal, fetchFn });
  return true;
}

async function runClaimedBatch(params: {
  pool: pg.Pool;
  db: WorkerDb;
  env: WorkerEnv;
  logger: WorkerLogger;
  claimed: ClaimedBatchJob;
  shutdownSignal: AbortSignal;
  fetchFn: typeof fetch;
}): Promise<void> {
  const { pool, db, env, logger, claimed, shutdownSignal, fetchFn } = params;
  const { batch, leaseToken, design, oauth } = claimed;
  const batchStartMs = Date.now();
  let peakRssMb = currentRssMb();

  logger.info('Claimed mail batch; exchanging PKCE authorization code', {
    batchId: batch.id,
    eventId: batch.eventId,
    totalItems: batch.totalItems,
  });

  const authOutcome = await exchangeBatchOAuthCode({
    env,
    code: oauth.code,
    codeVerifier: oauth.codeVerifier,
    redirectUri: oauth.redirectUri,
    expectedSenderEmail: batch.senderEmail,
    fetchImpl: fetchFn,
  });

  // Immediately clear plaintext code + verifier from claimed object once exchange completes.
  oauth.code = '';
  oauth.codeVerifier = '';

  if (!authOutcome.ok) {
    logger.warn('Batch OAuth exchange rejected', {
      batchId: batch.id,
      reasonCode: authOutcome.code,
    });
    await finalizeBatchOutcome(db, batch.id, leaseToken, { pauseReason: authOutcome.userMessage });
    return;
  }

  const token: InMemoryBatchToken = authOutcome.token;

  let renderer: WorkerRenderContext | null = null;
  let batchCancelled = false;
  let pauseAuthReason: string | null = null;
  let globalCooldownUntil = 0;

  const stopClaims = new AbortController();
  const abortOnShutdown = () => stopClaims.abort();
  shutdownSignal.addEventListener('abort', abortOnShutdown, { once: true });
  if (shutdownSignal.aborted) stopClaims.abort();

  const heartbeat = setInterval(async () => {
    try {
      peakRssMb = Math.max(peakRssMb, currentRssMb());
      const lease = await renewBatchLease(db, batch.id, leaseToken, env.WORKER_LEASE_SECONDS, peakRssMb);
      if (!lease.stillOwned) {
        stopClaims.abort();
        return;
      }
      if (lease.cancelling) {
        batchCancelled = true;
        stopClaims.abort();
        return;
      }
      if (!token.isValid()) {
        pauseAuthReason = 'Gmail access token expired cleanly. Re-authorize to resume pending recipients.';
        stopClaims.abort();
      }
    } catch (error) {
      logger.warn('Heartbeat renewal failed', { batchId: batch.id, error: error instanceof Error ? error.name : 'unknown' });
    }
  }, env.WORKER_HEARTBEAT_SECONDS * 1000);

  try {
    if (!await recordBatchAuthorized(db, batch.id, leaseToken, authOutcome.expiresAt)) {
      await finalizeBatchOutcome(db, batch.id, leaseToken);
      return;
    }
    if (shutdownSignal.aborted) {
      await finalizeBatchOutcome(db, batch.id, leaseToken, { pauseReason: 'Worker stopped during shutdown. Re-authorize to resume.' });
      return;
    }
    renderer = await WorkerRenderContext.create(design, logger, fetchFn);
    peakRssMb = Math.max(peakRssMb, currentRssMb());

    const prefs = batch.mailPreferences;
    const concurrency = Math.max(1, env.WORKER_SEND_CONCURRENCY);
    // Serialize Skia canvas draws across 1 renderer per dyno while bounding overlapping Gmail uploads.
    let renderChain = Promise.resolve();
    const withSingleRenderer = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = renderChain.then(fn, fn);
      renderChain = next.then(() => undefined, () => undefined);
      return next;
    };

    const runWorkerSlot = async () => {
      while (!stopClaims.signal.aborted && !shutdownSignal.aborted) {
        if (pauseAuthReason || batchCancelled) return;
        if (!token.isValid()) {
          pauseAuthReason = 'Gmail access token expired cleanly. Re-authorize to resume pending recipients.';
          stopClaims.abort();
          return;
        }

        const waitMs = globalCooldownUntil - Date.now();
        if (waitMs > 0) {
          await sleep(Math.min(waitMs, 5_000), stopClaims.signal);
          continue;
        }

        const claimedItem = await claimNextBatchItem(
          pool,
          db,
          batch.id,
          leaseToken,
          env.WORKER_LEASE_SECONDS
        );

        if (!claimedItem) {
          // Check if retries are still scheduled for the near future while token stays valid.
          const nextDelay = await earliestQueuedRetryDelayMs(db, batch.id);
          if (nextDelay === null || nextDelay > 45_000) return;
          if (Date.now() + nextDelay >= token.expiresAtMs - 20_000) return;
          await sleep(Math.min(nextDelay + 150, 5_000), stopClaims.signal);
          continue;
        }

        const { item, certificate } = claimedItem;
        const itemStartMs = Date.now();
        let dispatchAttempt: string | null = null;
        let message: Awaited<ReturnType<typeof stageGmailMessage>> | undefined;

        try {
          const email = certificate.recipientEmail?.trim() ?? '';
          if (!email || !certificate.renderFields || !['issued', 'static'].includes(certificate.status)) {
            await markItemTerminal(db, item.id, leaseToken, 'skipped', 'ineligible_certificate', 'Certificate cannot be mailed.');
            continue;
          }

          const resendVer = item.resendVersion ?? undefined;
          const target = {
            email: certificate.recipientEmail,
            status: certificate.mailStatus,
            version: certificate.mailAttemptId,
          };
          if (!target.email || !canClaimMail(target, resendVer)) {
            await markItemTerminal(
              db,
              item.id,
              leaseToken,
              'skipped',
              'delivery_blocked',
              target?.status === 'accepted'
                ? 'Already accepted by Gmail.'
                : target?.status === 'unknown'
                  ? 'Requires manual Gmail Sent reconciliation first.'
                  : 'Certificate mail state changed.'
            );
            continue;
          }

          const rendered = await withSingleRenderer(() =>
            renderer!.render({
              certificateId: certificate.id,
              recipientName: certificate.recipientName,
              renderFields: certificate.renderFields!,
              formats: { attachPdf: prefs.attachPdf, attachPng: Boolean(prefs.attachPng) },
              fallbackOrigin: batch.verificationOrigin ?? env.NEXT_PUBLIC_APP_URL,
            })
          );
          peakRssMb = Math.max(peakRssMb, currentRssMb());
          if (peakRssMb >= env.WORKER_MEMORY_SOFT_LIMIT_MB) {
            logger.warn('Worker memory approached dyno soft budget', {
              batchId: batch.id,
              itemId: item.id,
              softLimitMb: env.WORKER_MEMORY_SOFT_LIMIT_MB,
            });
          }

          const attachments: MailAttachment[] = [];
          const baseName = sanitizeAttachmentBaseName(rendered.filename);
          if (rendered.pngBuffer) attachments.push({ filename: `${baseName}.png`, content: rendered.pngBuffer });
          if (rendered.pdfBuffer) attachments.push({ filename: `${baseName}.pdf`, content: rendered.pdfBuffer });

          // Drop references to source buffers once assembled into attachments/MIME.
          rendered.pngBuffer = undefined;
          rendered.pdfBuffer = undefined;

          if (attachments.length === 0) {
            await markItemTerminal(db, item.id, leaseToken, 'failed', 'empty_attachments', 'No certificate attachments generated.');
            continue;
          }
          if (attachments.reduce((bytes, attachment) => bytes + attachment.content.byteLength, 0) > MAX_MAIL_ATTACHMENT_BYTES) {
            await markItemTerminal(db, item.id, leaseToken, 'failed', 'gmail_size_limit',
              'Attachments exceed 24 MB. Try sending the PDF by itself.');
            continue;
          }

          const rowMap = certificate.rowData && typeof certificate.rowData === 'object'
            ? (certificate.rowData as Record<string, string>)
            : {};
          const values: Record<string, string> = {
            Name: certificate.recipientName,
            Email: email,
            ...certificate.renderFields,
            ...rowMap,
          };

          const emailSubject = replaceTemplateVariables(prefs.subject, values).replace(/[\r\n]+/g, ' ').slice(0, 998);
          const emailBodyPlain = replaceTemplateVariables(prefs.bodyPlain, values);
          const emailBodyHtml = prefs.bodyHtml.trim()
            ? replaceTemplateVariables(prefs.bodyHtml, values, { html: true })
            : '';

          message = await stageGmailMessage({
            from: { name: batch.senderName, address: batch.senderEmail },
            to: target.email.trim(),
            subject: emailSubject,
            text: emailBodyPlain,
            html: emailBodyHtml.trim() || undefined,
            attachments,
          }, stopClaims.signal);
          attachments.length = 0;

          // Honor per-sender quota across all dynos & Vercel before claiming `sending`.
          let slot = await reserveWorkerMailSlot(batch.senderEmail, db);
          while (!slot.allowed) {
            if (slot.retryAfter === null) {
              pauseAuthReason = 'Issuance authorization was revoked for this sender.';
              await requeueItem(db, item.id, leaseToken, 0, null, null, true);
              stopClaims.abort();
              return;
            }
            const delaySec = Math.max(1, slot.retryAfter);
            globalCooldownUntil = Math.max(globalCooldownUntil, Date.now() + delaySec * 1000);
            if (stopClaims.signal.aborted || shutdownSignal.aborted) {
              await requeueItem(db, item.id, leaseToken, 0, 'quota_paused', 'Paused for per-sender quota.', true);
              return;
            }
            await sleep(Math.min(delaySec * 1000, 5_000), stopClaims.signal);
            slot = await reserveWorkerMailSlot(batch.senderEmail, db);
          }

          if (stopClaims.signal.aborted || shutdownSignal.aborted) {
            await requeueItem(db, item.id, leaseToken, 0, null, null, true);
            return;
          }

          const accessToken = token.getAccessToken();
          if (!accessToken) {
            pauseAuthReason = 'Gmail access token expired cleanly. Re-authorize to resume pending recipients.';
            await requeueItem(db, item.id, leaseToken, 0, null, null, true);
            stopClaims.abort();
            return;
          }

          const dispatch = await claimWorkerCertSend(db, claimed, item, target.email.trim());
          if (dispatch.status === 'stopped') return;
          if (dispatch.status === 'revoked') {
            pauseAuthReason = 'Issuance authorization was revoked for this sender.';
            stopClaims.abort();
            return;
          }
          if (dispatch.status === 'ineligible') {
            await markItemTerminal(db, item.id, leaseToken, 'skipped', 'claim_race_lost', 'Certificate state changed before sending.');
            continue;
          }

          const { attemptId } = dispatch;
          dispatchAttempt = attemptId;
          const finish = (outcome: Parameters<typeof finishWorkerCertSend>[4]) =>
            finishWorkerCertSend(db, claimed, item, attemptId, outcome);
          let gmailRes: Response;
          const upload = message.open();
          try {
            const uploadOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'message/rfc822',
                'Content-Length': String(message.byteLength),
              },
              body: upload,
              duplex: 'half',
              redirect: 'error',
              signal: AbortSignal.timeout(25_000),
            } as const;
            gmailRes = await fetchFn(
              `${env.WORKER_GMAIL_API_BASE.replace(/\/+$/, '')}/upload/gmail/v1/users/me/messages/send?uploadType=media`,
              uploadOptions
            );
          } catch {
            await finish({
              status: 'unknown', code: 'gmail_unconfirmed',
              detail: 'No response from Gmail after submission. Check Gmail Sent before retrying.',
            });
            continue;
          } finally {
            if (!upload.locked) await upload.cancel().catch(() => {});
          }

          if (gmailRes.status >= 500 || gmailRes.status === 408) {
            await gmailRes.body?.cancel().catch(() => {});
            await finish({
              status: 'unknown', code: `gmail_http_${gmailRes.status}_unconfirmed`,
              detail: 'Gmail returned an uncertain response after submission. Check Gmail Sent before retrying.',
            });
            continue;
          }

          if (gmailRes.ok) {
            const payload = (await gmailRes.json().catch(() => null)) as { id?: unknown } | null;
            await finish({
              status: 'accepted',
              gmailId: typeof payload?.id === 'string' ? payload.id.slice(0, 200) : null,
            });
            logger.info('Gmail accepted certificate', {
              batchId: batch.id, itemId: item.id, durationMs: Date.now() - itemStartMs,
            });
            continue;
          }

          let rateLimited = gmailRes.status === 429;
          let missingScope = false;
          if (gmailRes.status === 403) {
            const payload = (await gmailRes.json().catch(() => null)) as {
              error?: { errors?: Array<{ reason?: string }> };
            } | null;
            const reasons = Array.isArray(payload?.error?.errors) ? payload.error.errors.map((entry) => entry?.reason) : [];
            rateLimited = reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded');
            missingScope = reasons.includes('insufficientPermissions');
          } else {
            await gmailRes.body?.cancel().catch(() => {});
          }

          if (gmailRes.status === 401 || missingScope) {
            pauseAuthReason = missingScope ? 'Missing Gmail send permission. Re-authorize to resume.'
              : 'Gmail rejected the current authorization. Re-authorize to resume pending recipients.';
            token.clear();
            stopClaims.abort();
            await finish({
              status: 'retry', delaySeconds: 0, preserveAttempt: true,
              code: missingScope ? 'gmail_scope_denied' : 'gmail_401', detail: pauseAuthReason,
            });
            return;
          }

          if (rateLimited) {
            const backoffSec = parseRetryAfterSeconds(
              gmailRes.headers.get('retry-after'),
              Math.min(MAX_GMAIL_THROTTLE_BACKOFF_SEC, Math.pow(2, item.attemptCount) * 3)
            );
            globalCooldownUntil = Math.max(globalCooldownUntil, Date.now() + backoffSec * 1000);
            if (item.attemptCount < item.maxAttempts) {
              await finish({
                status: 'retry', delaySeconds: backoffSec, code: 'gmail_rate_limited',
                detail: 'Gmail throttled sending. This recipient is queued for retry.',
              });
            } else {
              await finish({
                status: 'failed', code: 'gmail_rate_limited_exhausted',
                detail: 'Exceeded maximum retries after repeated Gmail throttling.',
              });
            }
            continue;
          }

          await finish({
            status: 'failed', code: `gmail_http_${gmailRes.status}`,
            detail: `Gmail rejected this recipient (HTTP ${gmailRes.status}).`,
          });
        } catch (error) {
          logger.error('Recipient item processing failed', {
            batchId: batch.id,
            itemId: item.id,
            certificateId: certificate.id,
            error: error instanceof Error ? error.name : 'unknown',
          });
          if (dispatchAttempt) throw error;
          if (stopClaims.signal.aborted || shutdownSignal.aborted) {
            await requeueItem(db, item.id, leaseToken, 0, null, null, true);
            return;
          }
          if (error instanceof MailSizeError || error instanceof CertificateAttachmentSizeError) {
            await markItemTerminal(db, item.id, leaseToken, 'failed', 'gmail_size_limit', error.message);
          } else {
            await markItemTerminal(db, item.id, leaseToken, 'failed', 'render_or_dispatch_error',
              'Certificate rendering or delivery failed.');
          }
        } finally {
          await message?.dispose().catch(() => {
            logger.warn('Temporary Gmail message cleanup failed', { batchId: batch.id, itemId: item.id });
          });
        }
      }
    };

    const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      try {
        await runWorkerSlot();
      } catch (error) {
        stopClaims.abort();
        throw error;
      }
    }));
    if (results.some((result) => result.status === 'rejected')) {
      // Leave the lease for recovery. It will reconcile any in-flight submissions.
      throw new Error('Recipient processing could not persist its outcome.');
    }

    if (shutdownSignal.aborted && !batchCancelled && !pauseAuthReason) {
      pauseAuthReason = 'Worker stopped cleanly during shutdown or deploy. Re-authorize to resume.';
    }

    await finalizeBatchOutcome(db, batch.id, leaseToken, {
      pauseReason: pauseAuthReason ?? undefined,
      peakMemoryMb: peakRssMb,
    });
    logger.info('Worker released the batch token', {
      batchId: batch.id,
      durationMs: Date.now() - batchStartMs,
      peakRssMb,
    });
  } catch (error) {
    logger.error('Batch execution aborted unexpectedly', {
      batchId: batch.id,
      error: error instanceof Error ? error.name : 'unknown',
    });
    if (!renderer) {
      await finalizeBatchOutcome(db, batch.id, leaseToken, { failureReason: 'Batch stopped while loading the certificate design.' }).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
    shutdownSignal.removeEventListener('abort', abortOnShutdown);
    token.clear();
    renderer?.dispose();
    renderer = null;
  }
}
