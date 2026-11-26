import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../../../lib/db';
import { templates } from '../../../db/schema';
import { requireIssuer } from '../../../lib/issuer-auth';
import { env } from '../../../lib/env';
import { checkRateLimit } from '../../../lib/rate-limit';
import {
  isWithinImagePixelBudget,
  MAX_INLINE_TEMPLATE_BYTES,
  MAX_TEMPLATE_DATA_URL_LENGTH,
  parseImageDataUrl,
} from '../../../lib/image-validation';
import { isAllowedR2TemplateUrl, verifyR2Artwork } from '../../../lib/r2-storage';
import { validateEventLayout } from '../../../lib/event-design-validation';
import { snapshotTemplateVersion } from '../../../lib/template-versions';
import { log, requestIdOf } from '../../../lib/logger';

/** Template saves carry up to 15 MB images via R2 (or <= 3 MB inline). */
const SAVE_RATE_LIMIT = 30; // saves per minute

export async function GET(request: Request) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured' },
      { status: 503 }
    );
  }

  try {
    const rows = await db
      .select({
        id: templates.id,
        name: templates.name,
        imageHash: templates.imageHash,
        width: templates.width,
        height: templates.height,
        layoutConfig: templates.layoutConfig,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
      })
      .from(templates)
      .where(eq(templates.userId, user.userId))
      .orderBy(desc(templates.updatedAt));

    return NextResponse.json({ templates: rows });
  } catch (error) {
    log.error('templates', 'Failed to retrieve saved templates', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to retrieve saved templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`templates:save:${user.userId}`, SAVE_RATE_LIMIT, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many template saves. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { name, imageData, width, height, layoutConfig } = body;

    if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return NextResponse.json(
        { detail: 'Template name is required (max 200 characters)' },
        { status: 400 }
      );
    }

    const declaredWidth = typeof width === 'number' ? width : null;
    const declaredHeight = typeof height === 'number' ? height : null;
    if (declaredWidth !== null && declaredHeight !== null && !isWithinImagePixelBudget(declaredWidth, declaredHeight)) {
      return NextResponse.json({ detail: 'Template dimensions exceed the supported image budget' }, { status: 400 });
    }

    let effectiveWidth = declaredWidth;
    let effectiveHeight = declaredHeight;
    let serverImageHash: string;

    if (!isAllowedR2TemplateUrl(imageData, 'full')) {
      if (typeof imageData !== 'string' || imageData.length > MAX_TEMPLATE_DATA_URL_LENGTH) {
        return NextResponse.json(
          { detail: 'Template image is too large (max 3 MB inline)' },
          { status: 413 }
        );
      }

      // Data-URL shape, decoded magic bytes, byte budget, and pixel budget must all check out,
      // so a mislabeled, oversized, or OOM payload never reaches the templates table.
      const parsedImage = parseImageDataUrl(imageData);
      if (!parsedImage) {
        return NextResponse.json(
          { detail: 'Valid template image data (PNG, JPEG or WebP within dimension bounds) is required' },
          { status: 400 }
        );
      }
      if (parsedImage.bytes.byteLength > MAX_INLINE_TEMPLATE_BYTES) {
        return NextResponse.json(
          { detail: 'Template image is too large (max 3 MB inline)' },
          { status: 413 }
        );
      }

      if (parsedImage.dimensions && declaredWidth !== null && declaredHeight !== null) {
        const exactMatch = parsedImage.dimensions.width === declaredWidth && parsedImage.dimensions.height === declaredHeight;
        const exifSwappedMatch = parsedImage.dimensions.width === declaredHeight && parsedImage.dimensions.height === declaredWidth;
        if (!exactMatch && !exifSwappedMatch) {
          return NextResponse.json({ detail: 'Template dimensions do not match the uploaded image' }, { status: 400 });
        }
      }

      effectiveWidth = declaredWidth ?? parsedImage.dimensions?.width ?? null;
      effectiveHeight = declaredHeight ?? parsedImage.dimensions?.height ?? null;
      serverImageHash = createHash('sha256').update(parsedImage.bytes).digest('hex');
    } else if (declaredWidth === null || declaredHeight === null) {
      return NextResponse.json({ detail: 'Template width and height are required' }, { status: 400 });
    } else {
      const hash = await verifyR2Artwork(imageData, user.userId, 'full', declaredWidth, declaredHeight);
      if (!hash) return NextResponse.json({ detail: 'Uploaded artwork is missing, invalid, or does not belong to your account.' }, { status: 400 });
      serverImageHash = hash;
    }

    let validatedLayout = { boxes: [], qrZones: [] } as ReturnType<typeof validateEventLayout>;
    if (layoutConfig !== undefined && layoutConfig !== null) {
      validatedLayout = validateEventLayout(layoutConfig);
      if (!validatedLayout) {
        return NextResponse.json({ detail: 'Invalid layout configuration' }, { status: 400 });
      }
    }

    // Single-statement upsert on the unique (userId, name) index: concurrent
    // saves can never race into an unhandled unique violation.
    const save = db
      .insert(templates)
      .values({
        userId: user.userId,
        name: name.trim(),
        imageData,
        imageHash: serverImageHash,
        width: effectiveWidth,
        height: effectiveHeight,
        layoutConfig: validatedLayout || { boxes: [], qrZones: [] },
      })
      .onConflictDoUpdate({
        target: [templates.userId, templates.name],
        set: {
          imageData: sql`CASE WHEN ${templates.imageHash} = excluded.image_hash THEN ${templates.imageData} ELSE excluded.image_data END`,
          imageHash: serverImageHash,
          width: effectiveWidth,
          height: effectiveHeight,
          layoutConfig: validatedLayout || { boxes: [], qrZones: [] },
          updatedAt: new Date(),
        },
      })
      .returning({
        id: templates.id,
        name: templates.name,
        width: templates.width,
        height: templates.height,
        layoutConfig: templates.layoutConfig,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
      });

    const [[savedTemplate]] = await db.batch([
      save,
      ...snapshotTemplateVersion(user.userId, { name: name.trim() }),
    ]);
    if (!savedTemplate) throw new Error('Template save returned no row');

    return NextResponse.json({
      success: true,
      template: {
        id: savedTemplate.id,
        name: savedTemplate.name,
        width: savedTemplate.width,
        height: savedTemplate.height,
        layoutConfig: savedTemplate.layoutConfig,
        createdAt: savedTemplate.createdAt,
        updatedAt: savedTemplate.updatedAt,
      },
    });
  } catch (error) {
    log.error('templates', 'Failed to save template', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to save template' },
      { status: 500 }
    );
  }
}
