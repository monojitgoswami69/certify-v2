import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { templates } from '../../../../db/schema';
import { unauthorizedResponse } from '../../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../../lib/accounts';
import { log, requestIdOf } from '../../../../lib/logger';
import { isValidCertificateId as isValidUuid } from '../../../../lib/verification';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired session');
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
  }

  try {
    // Hash-keyed ETag: a re-open of an unchanged template answers 304 instead
    // of re-shipping the multi-MB base64 image.
    const [meta] = await db
      .select({ id: templates.id, imageHash: templates.imageHash })
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.userId)))
      .limit(1);

    if (!meta) {
      return NextResponse.json({ detail: 'Template not found' }, { status: 404 });
    }

    const etag = meta.imageHash ? `"${meta.imageHash}"` : `"${meta.id}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag },
      });
    }

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
      { headers: { ETag: etag } }
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
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired session');
  }

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
