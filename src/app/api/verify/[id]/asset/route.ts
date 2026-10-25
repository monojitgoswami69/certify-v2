import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { certificates, templates } from '../../../../../db/schema';
import { hashToken, isValidCertificateId } from '../../../../../lib/verification';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';
import { env } from '../../../../../lib/env';
import { log, requestIdOf } from '../../../../../lib/logger';
import { pickRenderFields } from '../../../../../lib/render-fields';

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
        userId: certificates.userId,
        status: certificates.status,
        recipientName: certificates.recipientName,
        templateName: certificates.templateName,
        rowData: certificates.rowData,
      })
      .from(certificates)
      .where(eq(certificates.tokenHash, hashToken(normalizedId)))
      .limit(1);

    if (!cert || cert.status !== 'issued') {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    // Resolve the issuing account's template by the certificate's stored
    // template name (exact, then extension-less — same convention as the
    // dashboard matcher). A deleted/renamed template means no preview.
    const templateName = cert.templateName?.trim().toLowerCase() ?? '';
    const templateBase = templateName.replace(/\.[^/.]+$/, '');

    let template: { imageData: string; width: number; height: number } | null = null;
    let layoutConfig: unknown = null;

    if (templateName) {
      const headers = await db
        .select({
          id: templates.id,
          name: templates.name,
        })
        .from(templates)
        .where(eq(templates.userId, cert.userId));

      const matched =
        headers.find((t) => t.name.trim().toLowerCase() === templateName) ??
        (templateBase ? headers.find((t) => t.name.trim().toLowerCase() === templateBase) : undefined);

      if (matched) {
        const [full] = await db
          .select({
            imageData: templates.imageData,
            width: templates.width,
            height: templates.height,
            layoutConfig: templates.layoutConfig,
          })
          .from(templates)
          .where(and(eq(templates.id, matched.id), eq(templates.userId, cert.userId)))
          .limit(1);

        if (full) {
          template = {
            imageData: full.imageData,
            width: full.width ?? 0,
            height: full.height ?? 0,
          };
          layoutConfig = full.layoutConfig;
        }
      }
    }

    // Only fields the template actually prints may leave the database.
    const fields = pickRenderFields(
      (cert.rowData as Record<string, string> | null) ?? null,
      (layoutConfig as { boxes?: Array<{ field?: string }> } | null) ?? null
    );

    return NextResponse.json(
      {
        status: 'ok',
        certificateId: cert.id,
        recipientName: cert.recipientName,
        template,
        layoutConfig,
        fields,
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
