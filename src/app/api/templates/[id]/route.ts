import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { templates } from '../../../../db/schema';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../lib/server-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  const { id } = await params;

  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);

    if (!template) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error('[Template GET by ID error]:', error);
    return NextResponse.json(
      { detail: 'Failed to retrieve template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired session');
  }

  const { id } = await params;

  try {
    const [deleted] = await db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning({ id: templates.id });

    if (!deleted) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error) {
    console.error('[Template DELETE error]:', error);
    return NextResponse.json(
      { detail: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
