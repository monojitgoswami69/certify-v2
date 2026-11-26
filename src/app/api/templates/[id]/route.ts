import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { templates } from '../../../../db/schema';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { log, requestIdOf } from '../../../../lib/logger';
import { isValidCertificateId as isValidUuid } from '../../../../lib/verification';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
  }

  try {
    const [template] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .limit(1);

    if (!template) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json(
      { template },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    log.error('templates', 'Failed to retrieve template', { requestId: requestIdOf(request), userId: user.userId }, error);
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
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
  }

  try {
    const [deleted] = await db
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .returning({ id: templates.id });

    if (!deleted) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error) {
    log.error('templates', 'Failed to delete template', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json(
      { detail: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
