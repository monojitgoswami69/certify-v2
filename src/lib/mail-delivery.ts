import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { certificates } from '../db/schema';
import type { PersistedMailStatus } from '../types';
import { db } from './db';

// Longer than both the Gmail timeout and the usual route lifetime. An expired
// claim is reviewable and never becomes eligible for another automatic send.
const expiredClaim = sql`${certificates.mailUpdatedAt} < now() - interval '2 minutes'`;
export const currentMailStatus = sql<PersistedMailStatus>`case
  when ${certificates.mailStatus} = 'sending' and (${expiredClaim}) then 'unknown'
  else ${certificates.mailStatus} end`;

function activeCertificate(userId: string, id: string) {
  return and(eq(certificates.id, id), eq(certificates.userId, userId), inArray(certificates.status, ['issued', 'static']));
}

function mailTarget(userId: string, id: string, email: string) {
  return and(activeCertificate(userId, id), sql`lower(btrim(${certificates.recipientEmail})) = ${email.toLowerCase()}`);
}

export async function getMailTarget(userId: string, id: string, email: string) {
  const [target] = await db.select({ status: currentMailStatus, version: certificates.mailAttemptId, email: certificates.recipientEmail }).from(certificates)
    .where(mailTarget(userId, id, email)).limit(1);
  return target;
}

export function canClaimMail(target: { status: PersistedMailStatus; version: string | null }, resendVersion?: string) {
  if (resendVersion) return target.status === 'accepted' && target.version === resendVersion;
  return target.status === 'pending' || target.status === 'failed';
}

export async function claimMail(userId: string, id: string, email: string, resendVersion?: string) {
  const attempt = randomUUID();
  const [result] = await db.update(certificates)
    .set({ mailStatus: 'sending', mailAttemptId: attempt, mailUpdatedAt: sql`now()`, mailDetail: null })
    .where(and(mailTarget(userId, id, email), resendVersion
      ? and(eq(certificates.mailStatus, 'accepted'), eq(certificates.mailAttemptId, resendVersion))
      : inArray(certificates.mailStatus, ['pending', 'failed'])))
    .returning({ attempt: certificates.mailAttemptId });
  return result?.attempt ?? null;
}

export async function finishMail(userId: string, id: string, attempt: string,
  status: Exclude<PersistedMailStatus, 'sending'>, detail: string | null, gmailId: string | null = null,
  previousAcceptedVersion?: string) {
  // Failed or blocked resends retain the earlier acceptance.
  // A later explicit resend must use a fresh dashboard read and confirmation.
  const preserveAcceptance = previousAcceptedVersion && (status === 'pending' || status === 'failed');
  const [result] = await db.update(certificates).set({
    mailStatus: preserveAcceptance ? 'accepted' : status,
    mailUpdatedAt: sql`now()`, mailDetail: detail,
    ...(preserveAcceptance ? {} : { mailGmailId: gmailId }),
  }).where(and(eq(certificates.id, id), eq(certificates.userId, userId),
    eq(certificates.mailStatus, 'sending'), eq(certificates.mailAttemptId, attempt)))
    .returning({ id: certificates.id });
  return Boolean(result);
}

export async function reconcileMail(userId: string, id: string, version: string | null, found: boolean) {
  const [result] = await db.update(certificates).set({
    mailStatus: found ? 'accepted' : 'pending', mailUpdatedAt: sql`now()`, mailAttemptId: randomUUID(),
    mailDetail: found ? 'Issuer confirmed the message in Gmail Sent.' : 'Issuer checked Gmail Sent and reopened this recipient.',
  }).where(and(activeCertificate(userId, id),
    version ? eq(certificates.mailAttemptId, version) : sql`${certificates.mailAttemptId} is null`,
    or(eq(certificates.mailStatus, 'unknown'), and(eq(certificates.mailStatus, 'sending'), expiredClaim)),
  )).returning({ id: certificates.id });
  return Boolean(result);
}
