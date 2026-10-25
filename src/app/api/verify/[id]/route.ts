import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { certificates, users } from '../../../../db/schema';
import { hashToken, isValidCertificateId } from '../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { getAuthenticatedUser } from '../../../../lib/accounts';
import { env, isDevelopment } from '../../../../lib/env';
import { log, requestIdOf } from '../../../../lib/logger';

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(3, local.length - visible.length))}${email.slice(at)}`;
}

/**
 * Public certificate verification endpoint backing the /verify/[id] page.
 * Malformed and unknown ids share the same neutral not_found response so the
 * endpoint cannot be used to enumerate issued certificates.
 * Operates purely read-only (zero scan tracking writes).
 *
 * Security & Privacy Policy:
 * Revoked certificates must NEVER leak PII to the public. Only the issuing account
 * can inspect revoked details, and only that account sees a recipient's full email.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const isDev = isDevelopment();
  const rateLimitMax = isDev ? 300 : 60;
  const rate = checkRateLimit(`verify:${getClientIp(request)}`, rateLimitMax, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { status: 'rate_limited', detail: 'Too many verification requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ status: 'not_found' });
  }

  const normalizedId = id.trim().toLowerCase();
  if (!isValidCertificateId(normalizedId)) {
    return NextResponse.json({ status: 'not_found' });
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { status: 'error', detail: 'Verification service is not configured' },
      { status: 503 }
    );
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
        issuerName: users.issuedByName,
        issuerAccountName: users.name,
      })
      .from(certificates)
      .leftJoin(users, eq(users.id, certificates.userId))
      .where(eq(certificates.tokenHash, tokenHash))
      .limit(1);

    if (!cert || cert.status === 'static') {
      return NextResponse.json({ status: 'not_found' });
    }

    const issuedBy =
      cert.issuerName?.trim() ||
      cert.issuerAccountName?.trim() ||
      env.ISSUED_BY ||
      env.NEXT_PUBLIC_ISSUED_BY ||
      'Certify';
    const viewer = await getAuthenticatedUser(request);
    const isOwner = viewer?.userId === cert.userId;

    // Revoked certificates never leak details except to the account that issued them.
    if (cert.status === 'revoked') {
      if (!isOwner) {
        // Public / unauthenticated caller: strictly return revoked status with zero details.
        // Cache-Control: no-store prevents caching proxies/browsers from caching or leaking information.
        return NextResponse.json(
          {
            status: 'revoked',
          },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Vary': 'Authorization, Cookie',
            },
          }
        );
      }

      // The issuing account may inspect the revoked record.
      return NextResponse.json(
        {
          status: 'revoked',
          recipientName: cert.recipientName,
          recipientEmail: cert.recipientEmail,
          eventName: cert.eventName,
          issuedAt: cert.issuedAt,
          issuedBy,
        },
        {
          headers: {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Vary': 'Authorization, Cookie',
          },
        }
      );
    }

    // Anyone holding the QR link may verify it. Only the issuing account sees the full email.
    return NextResponse.json(
      {
        status: 'valid',
        recipientName: cert.recipientName,
        recipientEmail: isOwner ? cert.recipientEmail : maskEmail(cert.recipientEmail),
        eventName: cert.eventName,
        issuedAt: cert.issuedAt,
        issuedBy,
      },
      {
        headers: {
          'Cache-Control': isOwner
            ? 'private, no-store'
            : 'public, max-age=15, stale-while-revalidate=30',
          'Vary': 'Authorization',
        },
      }
    );
  } catch (error) {
    log.error('verify', 'Verification temporarily unavailable', { requestId: requestIdOf(request), certId: id }, error);
    return NextResponse.json(
      { status: 'error', detail: 'Verification temporarily unavailable' },
      { status: 500 }
    );
  }
}
