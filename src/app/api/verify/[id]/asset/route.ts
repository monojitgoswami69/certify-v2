import { legacyVerificationOrigin } from '../../../../../lib/verification-links';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { certificates, events } from '../../../../../db/schema';
import type { IssuedEventDesign } from '../../../../../lib/event-design';
import {
  getCachedLockedDesign,
  isLockedDesignCacheEmpty,
  setCachedLockedDesign,
} from '../../../../../lib/locked-design-cache';
import { buildSignedTemplateAssetUrl, templateImageDigestHex } from '../../../../../lib/server-auth';
import { hashToken, isValidCertificateId } from '../../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';
import { env } from '../../../../../lib/env';
import { log, requestIdOf } from '../../../../../lib/logger';
import { verificationMaintenanceResponse } from '../../../../../lib/verification-maintenance';

/**
 * Public render-spec endpoint backing the verify page's certificate preview
 * and re-download. Returns only lightweight layout/render fields plus a
 * signed CDN-cacheable URL for the template image.
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
    // On a cold server instance (empty design cache), fetch `events.issuedDesign`
    // in the primary join so first-visit requests pay 1 remote DB round trip
    // instead of 2; once populated, skip fetching the JSONB blob on cache hits.
    const cacheEmpty = isLockedDesignCacheEmpty();
    const [cert] = await db
      .select({
        id: certificates.id,
        recipientName: certificates.recipientName,
        status: certificates.status,
        fields: certificates.renderFields,
        eventId: certificates.eventId,
        hasEventDesign: sql<boolean>`${events.issuedDesign} IS NOT NULL`,
        ...(cacheEmpty ? { inlineDesign: events.issuedDesign } : {}),
      })
      .from(certificates)
      .leftJoin(events, and(eq(events.id, certificates.eventId), eq(events.userId, certificates.userId)))
      .where(eq(certificates.tokenHash, hashToken(normalizedId)))
      .limit(1);

    if (!cert || cert.status !== 'issued' || cert.fields === null || !cert.eventId || !cert.hasEventDesign) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    let design: IssuedEventDesign | undefined =
      'inlineDesign' in cert && cert.inlineDesign
        ? (cert.inlineDesign as IssuedEventDesign)
        : getCachedLockedDesign(cert.eventId);

    if (design && 'inlineDesign' in cert && cert.inlineDesign) {
      setCachedLockedDesign(cert.eventId, design);
    } else if (!design) {
      const [eventRow] = await db
        .select({ design: events.issuedDesign })
        .from(events)
        .where(eq(events.id, cert.eventId))
        .limit(1);
      design = eventRow?.design ?? undefined;
      if (design) {
        setCachedLockedDesign(cert.eventId, design);
      }
    }

    if (!design) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const includeFull = new URL(request.url).searchParams.get('full') === '1';
    const { imageData, previewImageData, previewWidth, previewHeight, width, height, layoutConfig } = design;
    const usePreview = !includeFull && Boolean(previewImageData);
    const selectedDataUrl = usePreview ? previewImageData! : imageData;
    const kind = usePreview ? 'preview' : 'full';
    const imageUrl = buildSignedTemplateAssetUrl(cert.eventId, kind, templateImageDigestHex(selectedDataUrl));

    return NextResponse.json(
      {
        status: 'ok',
        certificateId: cert.id,
        recipientName: cert.recipientName,
        template: {
          imageUrl,
          width,
          height,
          ...(usePreview && previewWidth && previewHeight
            ? { previewWidth, previewHeight, isPreview: true }
            : { isPreview: false }),
        },
        layoutConfig,
        fields: cert.fields,
        verificationOrigin: design.verificationOrigin ?? legacyVerificationOrigin(request),
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
