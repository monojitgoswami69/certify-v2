import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { certificates } from '../../../../db/schema';
import { hashToken, isValidCertificateId } from '../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../lib/rate-limit';

/**
 * Public certificate verification endpoint backing the /verify/[id] page.
 * Malformed and unknown ids share the same neutral not_found response so the
 * endpoint cannot be used to enumerate issued certificates.
 * Operates purely read-only (zero scan tracking writes).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rate = checkRateLimit(`verify:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { status: 'rate_limited', detail: 'Too many verification requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (!isValidCertificateId(id)) {
    return NextResponse.json({ status: 'not_found' });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { status: 'error', detail: 'Verification service is not configured' },
      { status: 503 }
    );
  }

  try {
    const tokenHash = hashToken(id);
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

    return NextResponse.json({
      status: cert.status === 'revoked' ? 'revoked' : 'valid',
      recipientName: cert.recipientName,
      recipientEmail: cert.recipientEmail,
      eventName: cert.eventName,
      issuedAt: cert.issuedAt,
    });
  } catch (error) {
    console.error('[Verification error]:', error);
    return NextResponse.json(
      { status: 'error', detail: 'Verification temporarily unavailable' },
      { status: 500 }
    );
  }
}
