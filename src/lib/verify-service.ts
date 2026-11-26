import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { certificates, events, users } from '../db/schema';
import { hashToken, isValidCertificateId } from './verification';
import { getAuthenticatedUserFromSession } from './accounts';
import type { VerifiedSession } from './server-auth';
import { env } from './env';
import { log } from './logger';

export type VerifyResult =
  | {
      status: 'valid';
      recipientName: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt: string;
      issuedBy?: string | null;
      expiresAt?: string | null;
      expired?: boolean;
      verificationCount?: number;
    }
  | {
      status: 'revoked';
      recipientName?: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt?: string;
      issuedBy?: string | null;
    }
  | { status: 'not_found' }
  | { status: 'error'; detail?: string };

export interface ResolvedVerification {
  payload: VerifyResult;
  httpStatus: number;
  headers?: Record<string, string>;
}

/**
 * Shared live verification lookup used by both SSR `/verify/[id]` and `GET /api/verify/[id]`.
 * Guarantees consistent revocation hiding, owner-only email exposure, and scan counting.
 */
export async function resolveCertificateVerification({
  rawId,
  session,
  requestId,
}: {
  rawId: unknown;
  session: VerifiedSession | null;
  requestId?: string;
}): Promise<ResolvedVerification> {
  if (!rawId || typeof rawId !== 'string') {
    return { payload: { status: 'not_found' }, httpStatus: 200 };
  }

  const normalizedId = rawId.trim().toLowerCase();
  if (!isValidCertificateId(normalizedId)) {
    return { payload: { status: 'not_found' }, httpStatus: 200 };
  }

  if (!env.DATABASE_URL) {
    return {
      payload: { status: 'error', detail: 'Verification service is not configured' },
      httpStatus: 503,
    };
  }

  try {
    const tokenHash = hashToken(normalizedId);
    const [cert] = await db
      .select({
        id: certificates.id,
        userId: certificates.userId,
        status: certificates.status,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        eventName: certificates.eventName,
        issuedAt: certificates.issuedAt,
        scanCount: certificates.scanCount,
        eventId: certificates.eventId,
        eventTrackScans: events.trackScans,
        eventValidThrough: events.validThrough,
        eventIssuedBy: sql<string | null>`${events.issuedDesign}->>'issuedBy'`,
        issuerName: users.issuedByName,
        issuerAccountName: users.name,
      })
      .from(certificates)
      .leftJoin(users, eq(users.id, certificates.userId))
      .leftJoin(events, eq(events.id, certificates.eventId))
      .where(eq(certificates.tokenHash, tokenHash))
      .limit(1);

    if (!cert || cert.status === 'static') {
      return { payload: { status: 'not_found' }, httpStatus: 200 };
    }

    const issuedBy =
      cert.eventIssuedBy?.trim() ||
      cert.issuerName?.trim() ||
      cert.issuerAccountName?.trim() ||
      env.ISSUED_BY ||
      env.NEXT_PUBLIC_ISSUED_BY ||
      'WeCertify';

    const viewer = session ? await getAuthenticatedUserFromSession(session).catch(() => null) : null;
    const isOwner = viewer?.canIssueCertificates === true && viewer.userId === cert.userId;

    // Only the issuing account with current issuance access can inspect a revoked record.
    if (cert.status === 'revoked') {
      if (!isOwner) {
        return {
          payload: { status: 'revoked' },
          httpStatus: 200,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Vary': 'Authorization, Cookie',
          },
        };
      }

      return {
        payload: {
          status: 'revoked',
          recipientName: cert.recipientName,
          recipientEmail: cert.recipientEmail,
          eventName: cert.eventName,
          issuedAt: cert.issuedAt.toISOString(),
          issuedBy,
        },
        httpStatus: 200,
        headers: {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Vary': 'Authorization, Cookie',
        },
      };
    }

    let verificationCount: number | null = null;
    if (cert.eventTrackScans && !isOwner) {
      try {
        const [bumped] = await db
          .update(certificates)
          .set({ scanCount: sql`${certificates.scanCount} + 1`, lastScannedAt: new Date() })
          .where(and(eq(certificates.id, cert.id), eq(certificates.status, 'issued')))
          .returning({ scanCount: certificates.scanCount });
        verificationCount = bumped?.scanCount ?? cert.scanCount;
      } catch (scanErr) {
        log.warn('verify', 'Failed to update scan counter', { requestId }, scanErr);
      }
    } else if (cert.eventTrackScans) {
      verificationCount = cert.scanCount;
    }

    const expired =
      cert.eventValidThrough !== null && cert.eventValidThrough.getTime() < Date.now();

    return {
      payload: {
        status: 'valid',
        recipientName: cert.recipientName,
        ...(isOwner ? { recipientEmail: cert.recipientEmail } : {}),
        eventName: cert.eventName,
        issuedAt: cert.issuedAt.toISOString(),
        issuedBy,
        expiresAt: cert.eventValidThrough ? cert.eventValidThrough.toISOString() : null,
        expired,
        ...(verificationCount !== null ? { verificationCount } : {}),
      },
      httpStatus: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Vary': 'Authorization, Cookie',
      },
    };
  } catch (error) {
    log.error('verify', 'Verification temporarily unavailable', { requestId, certId: normalizedId }, error);
    return {
      payload: { status: 'error', detail: 'Verification temporarily unavailable' },
      httpStatus: 500,
    };
  }
}
