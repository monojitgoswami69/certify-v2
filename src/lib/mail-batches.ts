import crypto from 'node:crypto';
import { and, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm';
import { NeonDbError } from '@neondatabase/serverless';
import {
  certificates,
  events,
  mailBatches,
  mailBatchItems,
  mailBatchOauthHandoffs,
  type MailBatchRow,
} from '../db/schema';
import type { PublicUser } from './accounts';
import { db } from './db';
import { env, googleClientId } from './env';
import { isWithinImagePixelBudget, MAX_BACKGROUND_TEMPLATE_PIXELS } from './image-validation';
import { readMailPreferences, singleRecipientEmail } from './mail-preferences';
import { canClaimMail } from './mail-delivery';
import { isValidCertificateId } from './verification';
import {
  encryptHandoffSecret,
  generatePkcePair,
  isValidHandoffKey,
  sha256HexUtf8,
} from './worker-handoff';
import type { EmailSettings, MailBatchItemStatus, MailBatchStatus } from '../types';

export const WORKER_OAUTH_COOKIE = 'certify_worker_oauth';
export const MAX_BACKGROUND_BATCH_ITEMS = 2000;
const OAUTH_HANDOFF_TTL_MS = 10 * 60_000;
const CLAIM_CODE_TTL_MS = 180_000;

export const ACTIVE_BATCH_STATUSES: readonly MailBatchStatus[] = [
  'awaiting_auth',
  'queued',
  'running',
  'paused_auth',
  'paused_rate_limit',
  'cancelling',
];

export class MailBatchError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'MailBatchError';
  }
}

export function isBackgroundWorkerEnabled(): boolean {
  return Boolean(
    env.ENABLE_BACKGROUND_MAIL_WORKER &&
      isValidHandoffKey(env.WORKER_HANDOFF_KEY) &&
      googleClientId() &&
      env.GOOGLE_CLIENT_SECRET &&
      env.DATABASE_URL
  );
}

export interface BatchItemFailureSummary {
  itemId: string;
  certificateId: string;
  status: MailBatchItemStatus;
  attemptCount: number;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface MailBatchSummary {
  id: string;
  eventId: string;
  senderEmail: string;
  status: MailBatchStatus;
  statusReason: string | null;
  totalItems: number;
  counts: {
    queued: number;
    rendering: number;
    sending: number;
    accepted: number;
    failed: number;
    unknown: number;
    skipped: number;
    cancelled: number;
  };
  authExpiresAt: string | null;
  peakMemoryMb: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentFailures: BatchItemFailureSummary[];
}

function zeroCounts(): MailBatchSummary['counts'] {
  return {
    queued: 0,
    rendering: 0,
    sending: 0,
    accepted: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    cancelled: 0,
  };
}

export async function summarizeBatch(batch: MailBatchRow): Promise<MailBatchSummary> {
  const [grouped, failureRows] = await Promise.all([
    db
      .select({
        status: mailBatchItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(mailBatchItems)
      .where(eq(mailBatchItems.batchId, batch.id))
      .groupBy(mailBatchItems.status),
    db
      .select({
        itemId: mailBatchItems.id,
        certificateId: mailBatchItems.certificateId,
        status: mailBatchItems.status,
        attemptCount: mailBatchItems.attemptCount,
        errorCode: mailBatchItems.errorCode,
        errorDetail: mailBatchItems.errorDetail,
      })
      .from(mailBatchItems)
      .where(and(
        eq(mailBatchItems.batchId, batch.id),
        inArray(mailBatchItems.status, ['failed', 'unknown'])
      ))
      .orderBy(desc(mailBatchItems.updatedAt))
      .limit(20),
  ]);

  const counts = zeroCounts();
  for (const row of grouped) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = Number(row.count) || 0;
    }
  }

  return {
    id: batch.id,
    eventId: batch.eventId,
    senderEmail: batch.senderEmail,
    status: batch.status,
    statusReason: batch.statusReason ?? null,
    totalItems: batch.totalItems,
    counts,
    authExpiresAt: batch.authExpiresAt ? batch.authExpiresAt.toISOString() : null,
    peakMemoryMb: batch.peakMemoryMb ?? null,
    startedAt: batch.startedAt ? batch.startedAt.toISOString() : null,
    completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    recentFailures: failureRows,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof NeonDbError && cause.code === '23505';
}

export async function enqueueMailBatch(params: {
  user: PublicUser;
  eventId: string;
  certificateIds?: string[];
  mailPreferences?: unknown;
  allowResend?: boolean;
}): Promise<{ batch: MailBatchSummary; reused: boolean }> {
  if (!isBackgroundWorkerEnabled()) {
    throw new MailBatchError('Background delivery worker is not enabled on this deployment.', 503);
  }
  if (!isValidCertificateId(params.eventId)) {
    throw new MailBatchError('A valid eventId is required.', 400);
  }

  const [event] = await db
    .select({
      id: events.id,
      userId: events.userId,
      name: events.name,
      issuedDesign: events.issuedDesign,
      mailPreferences: events.mailPreferences,
    })
    .from(events)
    .where(and(eq(events.id, params.eventId), eq(events.userId, params.user.userId)))
    .limit(1);

  if (!event) {
    throw new MailBatchError('Event not found.', 404);
  }
  if (!event.issuedDesign) {
    throw new MailBatchError('Event design must be locked and issued before background mailing.', 409);
  }

  // Idempotent return when an active background batch already exists for this event.
  const [existingActive] = await db
    .select()
    .from(mailBatches)
    .where(and(
      eq(mailBatches.userId, params.user.userId),
      eq(mailBatches.eventId, event.id),
      inArray(mailBatches.status, [...ACTIVE_BATCH_STATUSES])
    ))
    .orderBy(desc(mailBatches.createdAt))
    .limit(1);

  if (existingActive) {
    return { batch: await summarizeBatch(existingActive), reused: true };
  }
  const { width, height } = event.issuedDesign;
  if (!isWithinImagePixelBudget(width, height) || width * height > MAX_BACKGROUND_TEMPLATE_PIXELS) {
    throw new MailBatchError('Background delivery supports templates up to 16 megapixels. Use the regular send option for this design.', 422);
  }

  const prefs: EmailSettings | null =
    params.mailPreferences !== undefined
      ? readMailPreferences(params.mailPreferences)
      : readMailPreferences(event.mailPreferences);

  if (!prefs) {
    throw new MailBatchError('Valid email preferences are required.', 400);
  }
  if (!prefs.attachPdf && !prefs.attachPng) {
    throw new MailBatchError('Background mailing requires at least one attachment (PDF or PNG).', 400);
  }

  // Enforce PDF+PNG only for background delivery (no JPG output in mailing).
  const normalizedPrefs: EmailSettings = {
    ...prefs,
    attachJpg: false,
    attachPng: Boolean(prefs.attachPng),
  };

  let requestedIds: string[] | null = null;
  if (params.certificateIds !== undefined) {
    if (!Array.isArray(params.certificateIds) || params.certificateIds.length === 0) {
      throw new MailBatchError('Select at least one issued certificate.', 400);
    }
    if (params.certificateIds.length > MAX_BACKGROUND_BATCH_ITEMS) {
      throw new MailBatchError(`A single background batch supports up to ${MAX_BACKGROUND_BATCH_ITEMS} certificates.`, 400);
    }
    const deduped = new Set<string>();
    for (const id of params.certificateIds) {
      if (typeof id !== 'string' || !isValidCertificateId(id.trim().toLowerCase())) {
        throw new MailBatchError('Selected certificate list contains an invalid certificate ID.', 400);
      }
      deduped.add(id.trim().toLowerCase());
    }
    requestedIds = Array.from(deduped);
  }

  const certRows = await db
    .select({
      id: certificates.id,
      status: certificates.status,
      recipientEmail: certificates.recipientEmail,
      renderFields: certificates.renderFields,
      mailStatus: certificates.mailStatus,
      mailAttemptId: certificates.mailAttemptId,
    })
    .from(certificates)
    .where(and(
      eq(certificates.userId, params.user.userId),
      eq(certificates.eventId, event.id),
      inArray(certificates.status, ['issued', 'static']),
      ...(requestedIds ? [inArray(certificates.id, requestedIds)] : [])
    ))
    .orderBy(certificates.issuedAt)
    .limit(MAX_BACKGROUND_BATCH_ITEMS);

  const eligible = certRows.filter((cert) => {
    const email = cert.recipientEmail?.trim() ?? '';
    if (!email || email.length > 320 || !singleRecipientEmail.test(email)) return false;
    if (!cert.renderFields) return false;
    if (params.allowResend && cert.mailStatus === 'accepted' && cert.mailAttemptId) return true;
    return canClaimMail({ status: cert.mailStatus, version: cert.mailAttemptId });
  });

  if (eligible.length === 0) {
    throw new MailBatchError('No eligible issued certificates with valid emails are ready to send.', 400);
  }

  const batchId = crypto.randomUUID();
  const itemInserts = [];
  const chunkSize = 500;
  for (let i = 0; i < eligible.length; i += chunkSize) {
    itemInserts.push(db.insert(mailBatchItems).values(
      eligible.slice(i, i + chunkSize).map((cert, idx) => ({
        batchId,
        certificateId: cert.id,
        userId: params.user.userId,
        recipientOrder: i + idx,
        resendVersion: cert.mailStatus === 'accepted' ? cert.mailAttemptId : null,
      }))
    ));
  }

  let createdBatch: MailBatchRow;
  try {
    const [[inserted]] = await db.batch([
      db.insert(mailBatches).values({
        id: batchId,
        userId: params.user.userId,
        eventId: event.id,
        senderEmail: params.user.email,
        senderName: params.user.name,
        status: 'awaiting_auth',
        mailPreferences: normalizedPrefs,
        totalItems: eligible.length,
        verificationOrigin: event.issuedDesign.verificationOrigin ?? null,
        statusReason: 'Authorize Gmail sending to start this background batch.',
      }).returning(),
      ...itemInserts,
      db.update(events)
        .set({ mailPreferences: normalizedPrefs, updatedAt: new Date() })
        .where(and(eq(events.id, event.id), eq(events.userId, params.user.userId))),
    ]);
    createdBatch = inserted;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [raced] = await db
        .select()
        .from(mailBatches)
        .where(and(
          eq(mailBatches.userId, params.user.userId),
          eq(mailBatches.eventId, event.id),
          inArray(mailBatches.status, [...ACTIVE_BATCH_STATUSES])
        ))
        .limit(1);
      if (raced) return { batch: await summarizeBatch(raced), reused: true };
    }
    throw error;
  }

  return { batch: await summarizeBatch(createdBatch), reused: false };
}

export function signOauthBindingCookie(userId: string, batchId: string, stateHash: string): string {
  const key = env.WORKER_HANDOFF_KEY ?? '';
  if (!isValidHandoffKey(key)) throw new MailBatchError('WORKER_HANDOFF_KEY is not configured.', 503);
  const sig = crypto
    .createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${userId}:${batchId}:${stateHash}`, 'utf8')
    .digest('hex');
  return `${batchId}.${stateHash}.${sig}`;
}

export function verifyOauthBindingCookie(
  cookieVal: string | undefined,
  userId: string,
  expectedStateHash: string
): string | null {
  if (!cookieVal) return null;
  const parts = cookieVal.split('.');
  if (parts.length !== 3) return null;
  const [batchId, cookieStateHash, providedSig] = parts;
  if (!isValidCertificateId(batchId) || cookieStateHash !== expectedStateHash) return null;
  const key = env.WORKER_HANDOFF_KEY ?? '';
  if (!isValidHandoffKey(key)) return null;
  const expectedSig = crypto
    .createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${userId}:${batchId}:${cookieStateHash}`, 'utf8')
    .digest('hex');
  const a = Buffer.from(providedSig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== 32 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return batchId;
}

export async function startBatchOAuthAuthorization(params: {
  user: PublicUser;
  batchId: string;
  origin: string;
}): Promise<{ authUrl: string; bindingCookie: string; batchId: string }> {
  if (!isBackgroundWorkerEnabled()) {
    throw new MailBatchError('Background delivery worker is not configured.', 503);
  }
  if (!isValidCertificateId(params.batchId)) {
    throw new MailBatchError('Batch not found.', 404);
  }

  const [batch] = await db
    .select({ id: mailBatches.id, status: mailBatches.status, userId: mailBatches.userId })
    .from(mailBatches)
    .where(and(eq(mailBatches.id, params.batchId), eq(mailBatches.userId, params.user.userId)))
    .limit(1);

  if (!batch) {
    throw new MailBatchError('Batch not found.', 404);
  }
  if (batch.status !== 'awaiting_auth' && batch.status !== 'paused_auth') {
    throw new MailBatchError(`Batch cannot be authorized in its current state (${batch.status}).`, 409);
  }

  const { state, stateHash, codeVerifier, codeChallenge } = generatePkcePair();
  const redirectUri = `${params.origin}/api/mail-batches/oauth/callback`;
  const handoffId = crypto.randomUUID();
  const encryptedVerifier = encryptHandoffSecret(
    codeVerifier,
    { handoffId, userId: params.user.userId, batchId: batch.id, kind: 'verifier' },
    env.WORKER_HANDOFF_KEY
  );

  await db.insert(mailBatchOauthHandoffs).values({
    id: handoffId,
    batchId: batch.id,
    userId: params.user.userId,
    stateHash,
    encryptedVerifier,
    redirectUri,
    expiresAt: new Date(Date.now() + OAUTH_HANDOFF_TTL_MS),
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', googleClientId());
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/gmail.send');
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('include_granted_scopes', 'false');
  authUrl.searchParams.set('prompt', 'consent select_account');
  authUrl.searchParams.set('login_hint', params.user.email);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return {
    authUrl: authUrl.toString(),
    bindingCookie: signOauthBindingCookie(params.user.userId, batch.id, stateHash),
    batchId: batch.id,
  };
}

export async function completeBatchOAuthCallback(params: {
  user: PublicUser;
  state: string;
  code: string;
  bindingCookie: string | undefined;
}): Promise<{ batchId: string; eventId: string }> {
  const stateHash = sha256HexUtf8(params.state);
  const boundBatchId = verifyOauthBindingCookie(params.bindingCookie, params.user.userId, stateHash);
  if (!boundBatchId) {
    throw new MailBatchError('OAuth session binding expired or did not match.', 403);
  }

  const [handoff] = await db
    .select()
    .from(mailBatchOauthHandoffs)
    .where(and(
      eq(mailBatchOauthHandoffs.stateHash, stateHash),
      eq(mailBatchOauthHandoffs.batchId, boundBatchId),
      eq(mailBatchOauthHandoffs.userId, params.user.userId),
      isNull(mailBatchOauthHandoffs.callbackReceivedAt),
      isNull(mailBatchOauthHandoffs.claimedAt),
      sql`${mailBatchOauthHandoffs.expiresAt} > now()`
    ))
    .limit(1);

  if (!handoff || !handoff.encryptedVerifier) {
    throw new MailBatchError('OAuth authorization expired or already used.', 409);
  }

  const encryptedCode = encryptHandoffSecret(
    params.code,
    { handoffId: handoff.id, userId: params.user.userId, batchId: handoff.batchId, kind: 'code' },
    env.WORKER_HANDOFF_KEY
  );

  const claimExpiry = new Date(Date.now() + CLAIM_CODE_TTL_MS);
  const ownedAwaitingBatch = and(
    eq(mailBatches.id, handoff.batchId),
    eq(mailBatches.userId, params.user.userId),
    inArray(mailBatches.status, ['awaiting_auth', 'paused_auth'])
  );
  const [, , [updatedBatch]] = await db.batch([
    // Use the same batch-first lock order as cancellation and the worker.
    db.select({ id: mailBatches.id }).from(mailBatches).where(ownedAwaitingBatch).for('update'),
    db.update(mailBatchOauthHandoffs).set({
      encryptedCode,
      callbackReceivedAt: new Date(),
      expiresAt: claimExpiry,
    }).where(and(
      eq(mailBatchOauthHandoffs.id, handoff.id),
      isNull(mailBatchOauthHandoffs.callbackReceivedAt),
      isNull(mailBatchOauthHandoffs.claimedAt),
      sql`${mailBatchOauthHandoffs.expiresAt} > now()`,
      exists(db.select({ id: mailBatches.id }).from(mailBatches).where(ownedAwaitingBatch))
    )),
    db.update(mailBatches).set({
      status: 'queued',
      nextAttemptAt: new Date(),
      statusReason: 'Authorized; queued for worker dispatch.',
      updatedAt: new Date(),
    }).where(and(ownedAwaitingBatch, exists(
      db.select({ id: mailBatchOauthHandoffs.id }).from(mailBatchOauthHandoffs).where(and(
        eq(mailBatchOauthHandoffs.id, handoff.id),
        eq(mailBatchOauthHandoffs.encryptedCode, encryptedCode)
      ))
    ))).returning({ id: mailBatches.id, eventId: mailBatches.eventId }),
  ]);
  if (!updatedBatch) {
    throw new MailBatchError('OAuth authorization expired or the batch is no longer waiting for authorization.', 409);
  }

  return { batchId: updatedBatch.id, eventId: updatedBatch.eventId };
}

export async function getEventBatchStatus(userId: string, eventId: string) {
  if (!isValidCertificateId(eventId)) {
    throw new MailBatchError('Invalid event ID.', 400);
  }
  const rows = await db
    .select()
    .from(mailBatches)
    .where(and(eq(mailBatches.userId, userId), eq(mailBatches.eventId, eventId)))
    .orderBy(desc(mailBatches.createdAt))
    .limit(5);

  const summaries = await Promise.all(rows.map((row) => summarizeBatch(row)));
  const active = summaries.find((b) => ACTIVE_BATCH_STATUSES.includes(b.status)) ?? summaries[0] ?? null;
  return {
    enabled: isBackgroundWorkerEnabled(),
    latestBatch: active,
    recentBatches: summaries,
  };
}

export async function getOwnedBatchSummary(userId: string, batchId: string): Promise<MailBatchSummary | null> {
  if (!isValidCertificateId(batchId)) return null;
  const [batch] = await db
    .select()
    .from(mailBatches)
    .where(and(eq(mailBatches.id, batchId), eq(mailBatches.userId, userId)))
    .limit(1);
  if (!batch) return null;
  return summarizeBatch(batch);
}

export async function cancelOwnedMailBatch(userId: string, batchId: string): Promise<MailBatchSummary> {
  if (!isValidCertificateId(batchId)) {
    throw new MailBatchError('Batch not found.', 404);
  }
  const now = new Date();
  const owner = and(eq(mailBatches.id, batchId), eq(mailBatches.userId, userId));
  const isRunning = sql`${mailBatches.status} in ('running', 'cancelling')`;
  const ownedActive = db.select({ id: mailBatches.id }).from(mailBatches)
    .where(and(owner, inArray(mailBatches.status, ['cancelling', 'cancelled'])));
  const [[updated], , , [current]] = await db.batch([
    db.update(mailBatches).set({
      status: sql`case when ${isRunning} then 'cancelling' else 'cancelled' end`,
      statusReason: sql`case when ${isRunning} then 'Cancellation requested by issuer; stopping after active sends.' else 'Cancelled by issuer.' end`,
      completedAt: sql`case when ${isRunning} then ${mailBatches.completedAt} else now() end`,
      leaseOwner: sql`case when ${isRunning} then ${mailBatches.leaseOwner} else null end`,
      leaseToken: sql`case when ${isRunning} then ${mailBatches.leaseToken} else null end`,
      leaseExpiresAt: sql`case when ${isRunning} then ${mailBatches.leaseExpiresAt} else null end`,
      updatedAt: now,
    }).where(and(owner, inArray(mailBatches.status, [...ACTIVE_BATCH_STATUSES]))).returning(),
    db.update(mailBatchItems).set({ status: 'cancelled', completedAt: now, updatedAt: now })
      .where(and(eq(mailBatchItems.batchId, batchId), eq(mailBatchItems.status, 'queued'),
        inArray(mailBatchItems.batchId, ownedActive))),
    db.update(mailBatchOauthHandoffs).set({ encryptedCode: null, encryptedVerifier: null, claimedAt: now })
      .where(and(eq(mailBatchOauthHandoffs.batchId, batchId), isNull(mailBatchOauthHandoffs.claimedAt),
        inArray(mailBatchOauthHandoffs.batchId, ownedActive))),
    db.select().from(mailBatches).where(owner).limit(1),
  ]);

  const batch = updated ?? current;
  if (!batch) throw new MailBatchError('Batch not found.', 404);
  return summarizeBatch(batch);
}
