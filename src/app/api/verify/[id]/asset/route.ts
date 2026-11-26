import { legacyVerificationOrigin } from '../../../../../lib/verification-links';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { certificates, events } from '../../../../../db/schema';
import { hashToken, isValidCertificateId } from '../../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';
import { env } from '../../../../../lib/env';
import { log, requestIdOf } from '../../../../../lib/logger';
import { verificationMaintenanceResponse } from '../../../../../lib/verification-maintenance';

/**
 * Public render-spec endpoint backing the verify page's certificate preview
 * and re-download. Returns only what a verifier's browser needs to redraw the
 * certificate face: the template graphic, its layout, and the CSV fields the
 * layout actually prints (never the rest of the registrant's row).
 *
 * Live status check on every request: revoked or static certificates get the
 * same neutral 404 as unknown ids, so the asset cannot outlive a revocation
 * or leak that an id exists.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (env.VERIFY_MAINTENANCE) return verificationMaintenanceResponse();
  const { id } = await params;

  const rate = checkRateLimit(`verify-asset:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { status: 'rate_limited', detail: 'Too many requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  const normalizedId = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!isValidCertificateId(normalizedId)) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { status: 'error', detail: 'Verification service is not configured' },
      { status: 503 }
    );
  }

  try {
    const [cert] = await db
      .select({
        id: certificates.id,
        recipientName: certificates.recipientName,
        status: certificates.status,
        fields: certificates.renderFields,
        design: events.issuedDesign,
      })
      .from(certificates)
      .leftJoin(events, and(eq(events.id, certificates.eventId), eq(events.userId, certificates.userId)))
      .where(eq(certificates.tokenHash, hashToken(normalizedId)))
      .limit(1);

    if (!cert || cert.status !== 'issued' || !cert.design || cert.fields === null) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const { imageData, width, height, layoutConfig } = cert.design;
    return NextResponse.json(
      {
        status: 'ok',
        certificateId: cert.id,
        recipientName: cert.recipientName,
        template: { imageData, width, height },
        layoutConfig,
        fields: cert.fields,
        verificationOrigin: cert.design.verificationOrigin ?? legacyVerificationOrigin(request),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );

  } catch (error) {
    log.error('verify-asset', 'Failed to load certificate render spec', { requestId: requestIdOf(request), certId: normalizedId }, error);
    return NextResponse.json(
      { status: 'error', detail: 'Verification temporarily unavailable' },
      { status: 500 }
    );
  }
}
