import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { templates } from '../../../db/schema';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../lib/server-auth';

export async function GET(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  if (!process.env.DATABASE_URL) {
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
      .orderBy(desc(templates.updatedAt));

    return NextResponse.json({ templates: rows });
  } catch (error) {
    console.error('[Templates GET error]:', error);
    return NextResponse.json(
      { detail: 'Failed to retrieve saved templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { detail: 'Database is not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { name, imageData, width, height, layoutConfig } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { detail: 'Template name is required' },
        { status: 400 }
      );
    }

    if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
      return NextResponse.json(
        { detail: 'Valid template image data (Base64 data URL) is required' },
        { status: 400 }
      );
    }

    // Check if a template with this exact name already exists to update it
    const existing = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.name, name.trim()))
      .limit(1);

    let savedTemplate;
    if (existing.length > 0) {
      const [updated] = await db
        .update(templates)
        .set({
          imageData,
          width: typeof width === 'number' ? width : null,
          height: typeof height === 'number' ? height : null,
          layoutConfig: layoutConfig || { boxes: [], qrZones: [] },
          updatedAt: new Date(),
        })
        .where(eq(templates.id, existing[0].id))
        .returning();
      savedTemplate = updated;
    } else {
      const [inserted] = await db
        .insert(templates)
        .values({
          name: name.trim(),
          imageData,
          width: typeof width === 'number' ? width : null,
          height: typeof height === 'number' ? height : null,
          layoutConfig: layoutConfig || { boxes: [], qrZones: [] },
        })
        .returning();
      savedTemplate = inserted;
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
    console.error('[Templates POST error]:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Failed to save template' },
      { status: 500 }
    );
  }
}
