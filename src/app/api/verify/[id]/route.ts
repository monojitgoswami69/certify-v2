import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { certificates } from '../../../../db/schema';
import { hashToken, isValidCertificateId } from '../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';
import { getAdminUserFromRequest } from '../../../../lib/server-auth';

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
 * Revoked certificates must NEVER leak PII or certificate details to unauthenticated
 * public callers. Only verified admins may inspect revoked certificate details.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const isDev = process.env.NODE_ENV === 'development';
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

  if (!process.env.DATABASE_URL) {
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
        status: certificates.status,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        eventName: certificates.eventName,
        issuedAt: certificates.issuedAt,
      })
      .from(certificates)
      .where(eq(certificates.tokenHash, tokenHash))
      .limit(1);

    if (!cert || cert.status === 'static') {
      return NextResponse.json({ status: 'not_found' });
    }

    const issuedBy = process.env.ISSUED_BY || process.env.NEXT_PUBLIC_ISSUED_BY || 'Certify';

    // Security & Privacy Policy: Revoked certificates must NEVER leak PII or certificate
    // details to unauthenticated public callers. Only verified admins may inspect details.
    if (cert.status === 'revoked') {
      const adminUser = getAdminUserFromRequest(request);

      if (!adminUser) {
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

      // Authenticated admin: allow inspection with no-store cache control
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

    // Valid certificate: anyone holding the QR link may verify it, but only admins see the full email
    const isAdmin = Boolean(getAdminUserFromRequest(request));
    return NextResponse.json(
      {
        status: 'valid',
        recipientName: cert.recipientName,
        recipientEmail: isAdmin ? cert.recipientEmail : maskEmail(cert.recipientEmail),
        eventName: cert.eventName,
        issuedAt: cert.issuedAt,
        issuedBy,
      },
      {
        headers: {
          'Cache-Control': isAdmin
            ? 'private, no-store'
            : 'public, max-age=15, stale-while-revalidate=30',
          'Vary': 'Authorization',
        },
      }
    );
  } catch (error) {
    console.error('[Verification error]:', error);
    return NextResponse.json(
      { status: 'error', detail: 'Verification temporarily unavailable' },
      { status: 500 }
    );
  }
}
