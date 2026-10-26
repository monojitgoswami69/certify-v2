import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { workspaceDrafts } from '../../../db/schema';
import { unauthorizedResponse } from '../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../lib/accounts';
import { env } from '../../../lib/env';
import { log, requestIdOf } from '../../../lib/logger';

const MAX_DRAFT_BYTES = 2.5 * 1024 * 1024;

/** Per-account autosaved session — recover a closed editor tab. */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse('Invalid or expired token');

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Database is not configured' }, { status: 503 });
  }

  try {
    const [row] = await db
      .select({ state: workspaceDrafts.state, updatedAt: workspaceDrafts.updatedAt })
      .from(workspaceDrafts)
      .where(eq(workspaceDrafts.userId, user.userId))
      .limit(1);
    if (!row) return NextResponse.json({ draft: null });
    return NextResponse.json({
      draft: { state: row.state, updatedAt: row.updatedAt.toISOString() },
    });
  } catch (error) {
    log.error('drafts', 'Failed to load workspace draft', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Failed to load draft' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse('Invalid or expired token');

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Database is not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const serialized = JSON.stringify(body?.state ?? null);
    if (serialized.length > MAX_DRAFT_BYTES) {
      // Drafts are a convenience; oversize sessions (giant CSVs) are skipped
      // rather than rejected — the UI keeps working either way.
      return NextResponse.json({ success: true, skipped: true, detail: 'Draft too large to autosave' });
    }

    await db
      .insert(workspaceDrafts)
      .values({ userId: user.userId, state: body?.state ?? {}, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: workspaceDrafts.userId,
        set: { state: body?.state ?? {}, updatedAt: new Date() },
      });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('drafts', 'Failed to save workspace draft', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Failed to save draft' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse('Invalid or expired token');

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Database is not configured' }, { status: 503 });
  }

  try {
    await db.delete(workspaceDrafts).where(eq(workspaceDrafts.userId, user.userId));
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('drafts', 'Failed to delete workspace draft', { requestId: requestIdOf(request) }, error);
    return NextResponse.json({ detail: 'Failed to delete draft' }, { status: 500 });
  }
}
