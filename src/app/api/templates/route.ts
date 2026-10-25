import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../../../lib/db';
import { templates } from '../../../db/schema';
import { unauthorizedResponse } from '../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../lib/accounts';
import { env } from '../../../lib/env';
import { checkRateLimit } from '../../../lib/rate-limit';
import { parseImageDataUrl } from '../../../lib/image-validation';
import { log, requestIdOf } from '../../../lib/logger';

const MAX_IMAGE_DATA_LENGTH = 20 * 1024 * 1024;
const MAX_LAYOUT_LENGTH = 1024 * 1024;
/** Template saves carry multi-MB images; cap per-account save frequency. */
const SAVE_RATE_LIMIT = 30; // saves per minute

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired session');
  }

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
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired session');
  }

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
    const { name, imageData, width, height, layoutConfig, imageHash } = body;

    if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return NextResponse.json(
        { detail: 'Template name is required (max 200 characters)' },
        { status: 400 }
      );
    }

    if (typeof imageData !== 'string' || imageData.length > MAX_IMAGE_DATA_LENGTH) {
      return NextResponse.json(
        { detail: 'Template image is too large (max ~15 MB)' },
        { status: 413 }
      );
    }

    // Data-URL shape AND decoded magic bytes must both check out, so a
    // mislabeled payload never reaches the templates table.
    const parsedImage = parseImageDataUrl(imageData);
    if (!parsedImage) {
      return NextResponse.json(
        { detail: 'Valid template image data (PNG, JPEG or WebP Base64 data URL) is required' },
        { status: 400 }
      );
    }

    if (
      layoutConfig !== undefined &&
      layoutConfig !== null &&
      (typeof layoutConfig !== 'object' ||
        Array.isArray(layoutConfig) ||
        (layoutConfig.boxes !== undefined && !Array.isArray(layoutConfig.boxes)) ||
        (layoutConfig.qrZones !== undefined && !Array.isArray(layoutConfig.qrZones)) ||
        JSON.stringify(layoutConfig).length > MAX_LAYOUT_LENGTH)
    ) {
      return NextResponse.json({ detail: 'Invalid layout configuration' }, { status: 400 });
    }

    // Server-side hash of the payload image. When it matches the stored row's
    // hash, the multi-MB image column is left untouched (layout-only save).
    const serverImageHash = createHash('sha256').update(imageData).digest('hex');
    const clientImageHash = typeof imageHash === 'string' && imageHash.length === 64 ? imageHash : null;
    const effectiveHash = clientImageHash === serverImageHash ? serverImageHash : null;

    // Single-statement upsert on the unique (userId, name) index: concurrent
    // saves can never race into an unhandled unique violation.
    const [savedTemplate] = await db
      .insert(templates)
      .values({
        userId: user.userId,
        name: name.trim(),
        imageData,
        imageHash: serverImageHash,
        width: typeof width === 'number' ? width : null,
        height: typeof height === 'number' ? height : null,
        layoutConfig: layoutConfig || { boxes: [], qrZones: [] },
      })
      .onConflictDoUpdate({
        target: [templates.userId, templates.name],
        set: {
          ...(effectiveHash
            ? // Hash matches what is (or was just) stored: skip the image rewrite.
              {}
            : { imageData, imageHash: serverImageHash }),
          width: typeof width === 'number' ? width : null,
          height: typeof height === 'number' ? height : null,
          layoutConfig: layoutConfig || { boxes: [], qrZones: [] },
          updatedAt: new Date(),
        },
        // Guard against a stale client overwriting a newer save: only update
        // when the stored hash matches the client's last-known image hash (or
        // the client sent none, meaning first save of this image).
        setWhere: effectiveHash
          ? sql`${templates.imageHash} = ${effectiveHash} OR ${templates.imageHash} IS NULL OR ${templates.imageHash} = ${serverImageHash}`
          : undefined,
      })
      .returning();

    if (!savedTemplate) {
      // setWhere rejected the write: a newer version exists server-side.
      const [current] = await db
        .select({
          id: templates.id,
          name: templates.name,
          width: templates.width,
          height: templates.height,
          layoutConfig: templates.layoutConfig,
          createdAt: templates.createdAt,
          updatedAt: templates.updatedAt,
        })
        .from(templates)
        .where(and(eq(templates.userId, user.userId), eq(templates.name, name.trim())))
        .limit(1);
      return NextResponse.json({
        success: true,
        conflict: true,
        template: current ?? null,
        detail: 'A newer version of this template was saved elsewhere; kept the newest copy.',
      });
    }

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
