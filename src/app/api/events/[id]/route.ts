import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { events } from '../../../../db/schema';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { env } from '../../../../lib/env';
import { isValidCertificateId } from '../../../../lib/verification';
import { log, requestIdOf } from '../../../../lib/logger';

/**
 * Per-event settings owned by the issuing account: opt-in verification
 * counting and the optional validity window.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { id } = await params;
  if (!isValidCertificateId(id)) {
    return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
  }

  let body: { trackScans?: unknown; validThrough?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  const updates: { trackScans?: boolean; validThrough?: Date | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (body.trackScans !== undefined) {
    updates.trackScans = Boolean(body.trackScans);
  }
  if (body.validThrough !== undefined) {
    if (body.validThrough === null || body.validThrough === '') {
      updates.validThrough = null;
    } else if (typeof body.validThrough === 'string') {
      const parsed = new Date(body.validThrough);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ detail: 'Invalid validThrough date' }, { status: 400 });
      }
      updates.validThrough = parsed;
    }
  }

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Database is not configured' }, { status: 503 });
  }

  try {
    const [updated] = await db
      .update(events)
      .set(updates)
      .where(and(eq(events.id, id), eq(events.userId, user.userId)))
      .returning({ id: events.id, trackScans: events.trackScans, validThrough: events.validThrough });

    if (!updated) {
      return NextResponse.json({ detail: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      event: {
        id: updated.id,
        trackScans: updated.trackScans,
        validThrough: updated.validThrough ? updated.validThrough.toISOString() : null,
      },
    });
  } catch (error) {
    log.error('events', 'Failed to update event settings', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Failed to update event settings' }, { status: 500 });
  }
}
