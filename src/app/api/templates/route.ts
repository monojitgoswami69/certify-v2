import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
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

    return NextResponse.json({
      success: true,
      template: {
        id: inserted.id,
        name: inserted.name,
        width: inserted.width,
        height: inserted.height,
        layoutConfig: inserted.layoutConfig,
        createdAt: inserted.createdAt,
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
