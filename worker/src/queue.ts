import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import {
  certificates,
  events,
  mailBatches,
  mailBatchItems,
  mailBatchOauthHandoffs,
  platformAccess,
  type MailBatchItemRow,
  type MailBatchRow,
} from '../../src/db/schema.js';
import type { PersistedMailStatus } from '../../src/types/index.js';
import type { IssuedEventDesign } from '../../src/lib/event-design.js';
import { claimMail, finishMail } from '../../src/lib/mail-delivery.js';
import { reserveMailSlot } from '../../src/lib/mail-quota.js';
import { decryptHandoffSecret } from '../../src/lib/worker-handoff.js';
import type { WorkerDb } from './db.js';
import type { WorkerLogger } from './logger.js';

export interface ClaimedBatchJob {
  batch: MailBatchRow;
  leaseToken: string;
  design: IssuedEventDesign;
  oauth: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  };
}

type WorkerQueryDb = Pick<WorkerDb, 'update'>;

export interface ClaimedBatchItem {
  item: MailBatchItemRow;
  certificate: {
    id: string;
    status: string;
    recipientName: string;
    recipientEmail: string | null;
    renderFields: Record<string, string> | null;
    rowData: unknown;
    mailStatus: PersistedMailStatus;
    mailAttemptId: string | null;
  };
}

export async function recoverAbandonedWork(
  pool: pg.Pool,
  logger: WorkerLogger
): Promise<number> {
  // Keep handoff cleanup outside recovery's batch-first lock order.
  await pool.query(`
    UPDATE mail_batch_oauth_handoffs
    SET encrypted_code = NULL, encrypted_verifier = NULL
    WHERE expires_at < now()
      AND (encrypted_code IS NOT NULL OR encrypted_verifier IS NOT NULL)
  `);
  const client = await pool.connect();
  let recoveredCount = 0;
  try {
    await client.query('BEGIN');

    const staleBatchesRes = await client.query<{ id: string; status: string }>(`
      SELECT id, status
      FROM mail_batches
      WHERE status IN ('running', 'cancelling')
        AND lease_expires_at < now()
      FOR UPDATE SKIP LOCKED
    `);

    for (const row of staleBatchesRes.rows) {
      recoveredCount++;
      const batchId = row.id;

      // Any item still in 'sending' might already have reached Gmail before the crash -> 'unknown'.
      const unconfirmedItems = await client.query<{ id: string }>(`
        UPDATE mail_batch_items
        SET status = 'unknown',
            error_code = 'worker_crash_unconfirmed',
            error_detail = 'Worker stopped after starting Gmail submission. Review Gmail Sent before retrying.',
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE batch_id = $1 AND status = 'sending'
        RETURNING id
      `, [batchId]);

      if (unconfirmedItems.rows.length > 0) {
        await client.query(`
          UPDATE certificates AS c
          SET mail_status = 'unknown', mail_updated_at = now(),
              mail_detail = 'Background worker stopped during Gmail submission. Check Gmail Sent before retrying.'
          FROM mail_batch_items AS i
          WHERE i.batch_id = $1 AND i.id = ANY($2::uuid[]) AND i.certificate_id = c.id
            AND i.user_id = c.user_id AND c.mail_status = 'sending'
            AND c.mail_updated_at <= i.submitted_to_gmail_at
        `, [batchId, unconfirmedItems.rows.map((r) => r.id)]);
      }

      if (row.status === 'cancelling') {
        await client.query(`
          UPDATE mail_batch_items
          SET status = 'cancelled',
              locked_by = NULL,
              locked_at = NULL,
              lease_expires_at = NULL,
              completed_at = now(),
              updated_at = now()
          WHERE batch_id = $1 AND status IN ('queued', 'rendering')
        `, [batchId]);

        await client.query(`
          UPDATE mail_batches
          SET status = 'cancelled',
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              auth_expires_at = NULL,
              completed_at = now(),
              status_reason = 'Cancelled after worker shutdown.',
              updated_at = now()
          WHERE id = $1
        `, [batchId]);
      } else {
        // Items still rendering never contacted Gmail -> return cleanly to 'queued'.
        await client.query(`
          UPDATE mail_batch_items
          SET status = 'queued',
              locked_by = NULL,
              locked_at = NULL,
              lease_expires_at = NULL,
              updated_at = now()
          WHERE batch_id = $1 AND status = 'rendering'
        `, [batchId]);

        await client.query(`
          UPDATE mail_batches
          SET status = 'paused_auth',
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              auth_expires_at = NULL,
              status_reason = 'Worker restarted or lease timed out. Re-authorize Gmail sending to resume.',
              updated_at = now()
          WHERE id = $1
        `, [batchId]);
      }

      logger.warn('Recovered stale batch lease after interruption', {
        batchId,
        previousStatus: row.status,
        unconfirmedSendingItems: unconfirmedItems.rows.length,
      });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return recoveredCount;
}

export async function claimNextQueuedBatch(params: {
  pool: pg.Pool;
  db: WorkerDb;
  workerId: string;
  leaseSeconds: number;
  handoffKey: string;
  logger: WorkerLogger;
}): Promise<ClaimedBatchJob | null> {
  const { pool, db, workerId, leaseSeconds, handoffKey, logger } = params;
  const leaseToken = randomUUID();

  const client = await pool.connect();
  let claimedBatchId: string;
  let handoffRow: {
    id: string;
    encrypted_code: string | null;
    encrypted_verifier: string | null;
    redirect_uri: string;
  } | null = null;

  try {
    await client.query('BEGIN');

    const candidate = await client.query<{ id: string }>(`
      SELECT id
      FROM mail_batches
      WHERE status = 'queued'
        AND next_attempt_at <= now()
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (candidate.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const batchId = candidate.rows[0].id;
    claimedBatchId = batchId;

    // Atomically read pre-wipe ciphertexts and null both columns in one transaction.
    const handoffRes = await client.query<{
      id: string;
      encrypted_code: string | null;
      encrypted_verifier: string | null;
      redirect_uri: string;
    }>(`
      WITH selected AS (
        SELECT id, encrypted_code, encrypted_verifier, redirect_uri
        FROM mail_batch_oauth_handoffs
        WHERE batch_id = $1
          AND callback_received_at IS NOT NULL
          AND claimed_at IS NULL
          AND expires_at > now()
          AND encrypted_code IS NOT NULL
          AND encrypted_verifier IS NOT NULL
        ORDER BY created_at DESC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      wiped AS (
        UPDATE mail_batch_oauth_handoffs h
        SET claimed_at = now(),
            encrypted_code = NULL,
            encrypted_verifier = NULL
        FROM selected s
        WHERE h.id = s.id
      )
      SELECT id, encrypted_code, encrypted_verifier, redirect_uri
      FROM selected
    `, [batchId]);

    if (handoffRes.rows.length === 0) {
      await client.query(`
        UPDATE mail_batches
        SET status = 'paused_auth',
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            status_reason = 'Authorization code expired before worker claimed it. Re-authorize to resume.',
            updated_at = now()
        WHERE id = $1
      `, [batchId]);
      await client.query('COMMIT');
      logger.warn('Queued batch missing usable OAuth handoff; paused for re-auth', { batchId });
      return null;
    }

    handoffRow = handoffRes.rows[0];

    await client.query(`
      UPDATE mail_batches
      SET status = 'running',
          lease_owner = $2,
          lease_token = $3,
          lease_expires_at = now() + ($4::int * interval '1 second'),
          attempt_count = attempt_count + 1,
          started_at = COALESCE(started_at, now()),
          status_reason = 'Claimed by worker; verifying Gmail authorization.',
          updated_at = now()
      WHERE id = $1
    `, [batchId, workerId, leaseToken, leaseSeconds]);

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const [claimedBatch] = await db.select().from(mailBatches)
    .where(and(eq(mailBatches.id, claimedBatchId), eq(mailBatches.leaseToken, leaseToken))).limit(1);
  if (!claimedBatch || !handoffRow?.encrypted_code || !handoffRow.encrypted_verifier) {
    return null;
  }

  let code: string;
  let codeVerifier: string;
  try {
    code = decryptHandoffSecret(
      handoffRow.encrypted_code,
      { handoffId: handoffRow.id, userId: claimedBatch.userId, batchId: claimedBatch.id, kind: 'code' },
      handoffKey
    );
    codeVerifier = decryptHandoffSecret(
      handoffRow.encrypted_verifier,
      { handoffId: handoffRow.id, userId: claimedBatch.userId, batchId: claimedBatch.id, kind: 'verifier' },
      handoffKey
    );
  } catch {
    await finalizeBatchOutcome(db, claimedBatch.id, leaseToken, { pauseReason: 'Could not decrypt Gmail handoff credentials. Re-authorize to resume.' });
    return null;
  }

  const [event] = await db
    .select({ issuedDesign: events.issuedDesign })
    .from(events)
    .where(and(eq(events.id, claimedBatch.eventId), eq(events.userId, claimedBatch.userId)))
    .limit(1);

  if (!event?.issuedDesign) {
    await finalizeBatchOutcome(db, claimedBatch.id, leaseToken, { failureReason: 'Locked event artwork is unavailable.' });
    return null;
  }

  return {
    batch: claimedBatch,
    leaseToken,
    design: event.issuedDesign,
    oauth: {
      code,
      codeVerifier,
      redirectUri: handoffRow.redirect_uri,
    },
  };
}

export async function recordBatchAuthorized(
  db: WorkerDb,
  batchId: string,
  leaseToken: string,
  authExpiresAt: Date
): Promise<boolean> {
  const [updated] = await db
    .update(mailBatches)
    .set({
      authExpiresAt,
      statusReason: 'Sending certificates in background…',
      updatedAt: new Date(),
    })
    .where(and(eq(mailBatches.id, batchId), eq(mailBatches.leaseToken, leaseToken),
      eq(mailBatches.status, 'running'), sql`${mailBatches.leaseExpiresAt} > now()`))
    .returning({ id: mailBatches.id });
  return Boolean(updated);
}

export async function renewBatchLease(
  db: WorkerDb,
  batchId: string,
  leaseToken: string,
  leaseSeconds: number,
  peakMemoryMb: number
): Promise<{ stillOwned: boolean; cancelling: boolean }> {
  const [row] = await db
    .update(mailBatches)
    .set({
      leaseExpiresAt: sql`now() + (${leaseSeconds} * interval '1 second')`,
      peakMemoryMb: sql`greatest(coalesce(${mailBatches.peakMemoryMb}, 0), ${peakMemoryMb})`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(mailBatches.id, batchId),
      eq(mailBatches.leaseToken, leaseToken),
      sql`${mailBatches.leaseExpiresAt} > now()`,
      inArray(mailBatches.status, ['running', 'cancelling'])
    ))
    .returning({ status: mailBatches.status });

  if (!row) return { stillOwned: false, cancelling: false };
  return { stillOwned: true, cancelling: row.status === 'cancelling' };
}

export async function claimNextBatchItem(
  pool: pg.Pool,
  db: WorkerDb,
  batchId: string,
  leaseToken: string,
  leaseSeconds: number
): Promise<ClaimedBatchItem | null> {
  // Single atomic CTE claims the next ready recipient and joins its trusted certificate record.
  const res = await pool.query<{
    id: string;
    batch_id: string;
    certificate_id: string;
    user_id: string;
    recipient_order: number;
    status: MailBatchItemRow['status'];
    attempt_count: number;
    max_attempts: number;
    resend_version: string | null;
    next_attempt_at: Date;
    locked_by: string | null;
    locked_at: Date | null;
    lease_expires_at: Date | null;
    submitted_to_gmail_at: Date | null;
    gmail_message_id: string | null;
    error_code: string | null;
    error_detail: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    cert_id: string | null;
    cert_status: string | null;
    cert_recipient_name: string | null;
    cert_recipient_email: string | null;
    cert_render_fields: Record<string, string> | null;
    cert_row_data: unknown;
    cert_mail_status: PersistedMailStatus | null;
    cert_mail_attempt_id: string | null;
  }>(`
    WITH picked AS (
      SELECT id
      FROM mail_batch_items
      WHERE batch_id = $1
        AND status = 'queued'
        AND next_attempt_at <= now()
        AND EXISTS (
          SELECT 1 FROM mail_batches
          WHERE id = $1 AND lease_token = $2 AND status = 'running' AND lease_expires_at > now()
        )
      ORDER BY recipient_order ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ),
    updated AS (
      UPDATE mail_batch_items m
      SET status = 'rendering',
          attempt_count = m.attempt_count + 1,
          locked_by = $2,
          locked_at = now(),
          lease_expires_at = now() + ($3::int * interval '1 second'),
          started_at = COALESCE(m.started_at, now()),
          updated_at = now()
      FROM picked
      WHERE m.id = picked.id
      RETURNING m.*
    )
    SELECT
      u.*,
      c.id AS cert_id,
      c.status AS cert_status,
      c.recipient_name AS cert_recipient_name,
      c.recipient_email AS cert_recipient_email,
      c.render_fields AS cert_render_fields,
      c.row_data AS cert_row_data,
      CASE
        WHEN c.mail_status = 'sending' AND c.mail_updated_at < now() - interval '2 minutes' THEN 'unknown'
        ELSE c.mail_status
      END AS cert_mail_status,
      c.mail_attempt_id AS cert_mail_attempt_id
    FROM updated u
    LEFT JOIN certificates c ON c.id = u.certificate_id AND c.user_id = u.user_id
      AND c.event_id = (SELECT event_id FROM mail_batches WHERE id = $1)
  `, [batchId, leaseToken, leaseSeconds]);

  const row = res.rows[0];
  if (!row) return null;

  const claimedItem: MailBatchItemRow = {
    id: row.id,
    batchId: row.batch_id,
    certificateId: row.certificate_id,
    userId: row.user_id,
    recipientOrder: row.recipient_order,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    resendVersion: row.resend_version,
    nextAttemptAt: new Date(row.next_attempt_at),
    lockedBy: row.locked_by,
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    submittedToGmailAt: row.submitted_to_gmail_at ? new Date(row.submitted_to_gmail_at) : null,
    gmailMessageId: row.gmail_message_id,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };

  if (!row.cert_id || !row.cert_status || row.cert_recipient_name === null || !row.cert_mail_status) {
    await markItemTerminal(db, claimedItem.id, leaseToken, 'skipped', 'cert_not_found', 'Certificate record no longer exists.');
    return null;
  }

  return {
    item: claimedItem,
    certificate: {
      id: row.cert_id,
      status: row.cert_status,
      recipientName: row.cert_recipient_name,
      recipientEmail: row.cert_recipient_email,
      renderFields: row.cert_render_fields,
      rowData: row.cert_row_data,
      mailStatus: row.cert_mail_status,
      mailAttemptId: row.cert_mail_attempt_id,
    },
  };
}

export async function markItemTerminal(
  db: WorkerQueryDb,
  itemId: string,
  leaseToken: string,
  status: 'accepted' | 'failed' | 'unknown' | 'skipped' | 'cancelled',
  errorCode: string | null = null,
  errorDetail: string | null = null,
  gmailMessageId: string | null = null
): Promise<void> {
  await db
    .update(mailBatchItems)
    .set({
      status,
      errorCode,
      errorDetail,
      gmailMessageId,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(ownedItem(itemId, leaseToken));
}

function ownedItem(itemId: string, leaseToken: string) {
  return and(eq(mailBatchItems.id, itemId), eq(mailBatchItems.lockedBy, leaseToken),
    inArray(mailBatchItems.status, ['rendering', 'sending']));
}

export async function requeueItem(
  db: WorkerQueryDb,
  itemId: string,
  leaseToken: string,
  delaySeconds = 0,
  errorCode: string | null = null,
  errorDetail: string | null = null,
  decrementAttempt = false,
  resendVersion?: string
): Promise<void> {
  await db
    .update(mailBatchItems)
    .set({
      status: 'queued',
      ...(decrementAttempt ? { attemptCount: sql`greatest(0, ${mailBatchItems.attemptCount} - 1)` } : {}),
      nextAttemptAt: delaySeconds > 0 ? sql`now() + (${delaySeconds} * interval '1 second')` : sql`now()`,
      errorCode,
      errorDetail,
      ...(resendVersion ? { resendVersion } : {}),
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      submittedToGmailAt: null,
      updatedAt: new Date(),
    })
    .where(ownedItem(itemId, leaseToken));
}

export async function reserveWorkerMailSlot(senderEmail: string, db: WorkerDb) {
  return reserveMailSlot(senderEmail, db);
}

export async function claimWorkerCertSend(db: WorkerDb, job: ClaimedBatchJob, item: MailBatchItemRow, email: string) {
  const { batch, leaseToken } = job;
  return db.transaction(async (tx) => {
    const [lease] = await tx.select({ status: mailBatches.status }).from(mailBatches)
      .where(and(eq(mailBatches.id, batch.id), eq(mailBatches.leaseToken, leaseToken),
        sql`${mailBatches.leaseExpiresAt} > now()`)).for('update');
    if (lease?.status !== 'running') return { status: 'stopped' } as const;
    const [access] = await tx.select({ allowed: platformAccess.canIssueCertificates }).from(platformAccess)
      .where(eq(platformAccess.email, batch.senderEmail)).for('update');
    if (!access?.allowed) return { status: 'revoked' } as const;

    const [owned] = await tx.select({ id: mailBatchItems.id }).from(mailBatchItems)
      .where(and(ownedItem(item.id, leaseToken), eq(mailBatchItems.status, 'rendering'))).for('update');
    if (!owned) return { status: 'stopped' } as const;

    const attemptId = await claimMail(batch.userId, item.certificateId, email, item.resendVersion ?? undefined, tx);
    if (!attemptId) return { status: 'ineligible' } as const;

    await tx.update(mailBatchItems).set({ status: 'sending', submittedToGmailAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(mailBatchItems.id, item.id));
    return { status: 'claimed', attemptId } as const;
  });
}

type DispatchOutcome = {
  code?: string;
  detail?: string;
} & (
  | { status: 'accepted'; gmailId: string | null }
  | { status: 'failed' | 'unknown' }
  | { status: 'retry'; delaySeconds: number; preserveAttempt?: boolean }
);

export async function finishWorkerCertSend(
  db: WorkerDb,
  job: ClaimedBatchJob,
  item: MailBatchItemRow,
  attempt: string,
  outcome: DispatchOutcome
): Promise<void> {
  const { batch, leaseToken } = job;
  await db.transaction(async (tx) => {
    const [lease] = await tx.select({ id: mailBatches.id }).from(mailBatches)
      .where(and(eq(mailBatches.id, batch.id), eq(mailBatches.leaseToken, leaseToken))).for('update');
    if (!lease) return;
    const gmailId = outcome.status === 'accepted' ? outcome.gmailId : null;
    const confirmed = await finishMail(batch.userId, item.certificateId, attempt,
      outcome.status === 'retry' ? 'failed' : outcome.status, outcome.detail ?? null,
      gmailId, item.resendVersion ?? undefined, tx);

    if (!confirmed) {
      await markItemTerminal(tx, item.id, leaseToken, 'unknown', 'dispatch_state_changed',
        'Delivery state changed after submission. Check Gmail Sent.');
    } else if (outcome.status === 'retry') {
      await requeueItem(tx, item.id, leaseToken, outcome.delaySeconds,
        outcome.code, outcome.detail, outcome.preserveAttempt, item.resendVersion ? attempt : undefined);
    } else {
      await markItemTerminal(tx, item.id, leaseToken, outcome.status, outcome.code, outcome.detail, gmailId);
    }
  });
}

type BatchStopOptions = { pauseReason?: string; failureReason?: string; peakMemoryMb?: number };

export async function finalizeBatchOutcome(
  db: WorkerDb,
  batchId: string,
  leaseToken: string,
  options: BatchStopOptions = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select({ status: mailBatches.status }).from(mailBatches)
      .where(and(eq(mailBatches.id, batchId), eq(mailBatches.leaseToken, leaseToken),
        sql`${mailBatches.leaseExpiresAt} > now()`)).for('update');
    if (!batch) return;

    const counts = await tx.select({ status: mailBatchItems.status, count: sql<number>`count(*)::int` })
      .from(mailBatchItems).where(eq(mailBatchItems.batchId, batchId)).groupBy(mailBatchItems.status);
    const summary = new Map(counts.map((row) => [row.status, Number(row.count)]));
    if (summary.get('sending')) {
      // Interrupted submissions are reconciled by lease recovery before another worker can claim this batch.
      return;
    }

    const cancelled = batch.status === 'cancelling';
    const outstanding = (summary.get('queued') ?? 0) + (summary.get('rendering') ?? 0);
    const status = cancelled ? 'cancelled' : options.failureReason ? 'failed'
      : options.pauseReason || outstanding ? 'paused_auth' : 'completed';
    if (outstanding) {
      const itemStatus = status === 'paused_auth' ? 'queued' : status === 'cancelled' ? 'cancelled' : 'failed';
      await tx.update(mailBatchItems).set({
        status: itemStatus,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        submittedToGmailAt: null,
        updatedAt: sql`now()`,
        ...(itemStatus === 'queued' ? {} : { completedAt: sql`now()` }),
        ...(itemStatus === 'failed' ? { errorCode: 'batch_terminal_error', errorDetail: options.failureReason } : {}),
      }).where(and(eq(mailBatchItems.batchId, batchId),
        inArray(mailBatchItems.status, itemStatus === 'queued' ? ['rendering'] : ['queued', 'rendering'])));
    }

    const accepted = summary.get('accepted') ?? 0;
    const failed = summary.get('failed') ?? 0;
    const unknown = summary.get('unknown') ?? 0;
    const skipped = summary.get('skipped') ?? 0;
    const statusReason = status === 'paused_auth'
      ? options.pauseReason ?? 'Pending deliveries remain. Re-authorize Gmail sending to resume.'
      : status === 'failed' ? options.failureReason
        : `${cancelled ? 'Cancelled' : 'Completed'}: ${accepted} accepted by Gmail${failed ? `, ${failed} failed` : ''}${unknown ? `, ${unknown} unconfirmed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`;

    await tx.update(mailBatches).set({
      status,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      authExpiresAt: null,
      ...(options.peakMemoryMb ? {
        peakMemoryMb: sql`greatest(coalesce(${mailBatches.peakMemoryMb}, 0), ${options.peakMemoryMb})`,
      } : {}),
      completedAt: status === 'paused_auth' ? null : sql`now()`,
      statusReason,
      updatedAt: sql`now()`,
    }).where(eq(mailBatches.id, batchId));
  });
}

export async function earliestQueuedRetryDelayMs(db: WorkerDb, batchId: string): Promise<number | null> {
  const rows = await db
    .select({
      // Note: do NOT wrap in Postgres greatest(0, ...), because greatest(0, NULL) returns 0!
      sec: sql<string | number | null>`extract(epoch from (min(${mailBatchItems.nextAttemptAt}) - now()))`,
    })
    .from(mailBatchItems)
    .where(and(eq(mailBatchItems.batchId, batchId), eq(mailBatchItems.status, 'queued')));

  const raw = rows[0]?.sec;
  if (raw === null || raw === undefined) return null;
  const sec = Number(raw);
  if (!Number.isFinite(sec)) return null;
  return Math.max(0, Math.ceil(sec * 1000));
}

export { mailBatchOauthHandoffs };
