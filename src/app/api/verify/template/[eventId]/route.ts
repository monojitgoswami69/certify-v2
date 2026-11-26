import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { events } from '../../../../../db/schema';
import { env } from '../../../../../lib/env';
import { parseImageDataUrl } from '../../../../../lib/image-validation';
import { getCachedLockedDesign, setCachedLockedDesign } from '../../../../../lib/locked-design-cache';
import { log, requestIdOf } from '../../../../../lib/logger';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';
import {
  templateImageDigestHex,
  verifyTemplateAssetParams,
  type TemplateAssetKind,
} from '../../../../../lib/server-auth';
import { isValidCertificateId } from '../../../../../lib/verification';
import { verificationMaintenanceResponse } from '../../../../../lib/verification-maintenance';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, s-maxage=31536000, immutable';

/**
 * Serves the immutable event certificate artwork (preview WebP or full-resolution
 * original) as raw binary bytes under an HMAC-signed, content-addressed URL so
 * Vercel Edge CDN and browsers cache the template globally with zero base64 bloat.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  if (env.VERIFY_MAINTENANCE) return verificationMaintenanceResponse();

  const { eventId } = await params;
  const normalizedEventId = typeof eventId === 'string' ? eventId.trim().toLowerCase() : '';
  const url = new URL(request.url);
  const kindParam = url.searchParams.get('kind');
  const kind: TemplateAssetKind | null =
    kindParam === 'preview' || kindParam === 'full' ? kindParam : null;
  const v = url.searchParams.get('v')?.trim().toLowerCase() ?? '';
  const sig = url.searchParams.get('sig')?.trim().toLowerCase() ?? '';

  if (
    !isValidCertificateId(normalizedEventId) ||
    !kind ||
    !verifyTemplateAssetParams(normalizedEventId, kind, v, sig)
  ) {
    return NextResponse.json(
      { status: 'forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { status: 'error', detail: 'Verification service is not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    let design = getCachedLockedDesign(normalizedEventId);
    if (!design) {
      const rate = checkRateLimit(`verify-tpl:${getClientIp(request)}`, 60, 60_000);
      if (!rate.allowed) {
        return NextResponse.json(
          { status: 'rate_limited', detail: 'Too many requests. Try again shortly.' },
          { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec), 'Cache-Control': 'no-store' } }
        );
      }

      const [eventRow] = await db
        .select({ design: events.issuedDesign })
        .from(events)
        .where(eq(events.id, normalizedEventId))
        .limit(1);
      design = eventRow?.design ?? undefined;
      if (design) {
        setCachedLockedDesign(normalizedEventId, design);
      }
    }

    if (!design) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const selectedDataUrl = kind === 'preview' ? design.previewImageData : design.imageData;
    if (!selectedDataUrl || templateImageDigestHex(selectedDataUrl) !== v) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const parsed = parseImageDataUrl(selectedDataUrl);
    if (!parsed) {
      return NextResponse.json({ status: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    return new NextResponse(Buffer.from(parsed.bytes), {
      status: 200,
      headers: {
        'Content-Type': `image/${parsed.mime}`,
        'Content-Length': String(parsed.bytes.byteLength),
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.error(
      'verify-template',
      'Failed to serve certificate template binary',
      { requestId: requestIdOf(request), eventId: normalizedEventId },
      error
    );
    return NextResponse.json(
      { status: 'error', detail: 'Verification temporarily unavailable' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
