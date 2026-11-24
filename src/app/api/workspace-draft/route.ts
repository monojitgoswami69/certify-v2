import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { workspaceDrafts } from '../../../db/schema';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { requireIssuer } from '../../../lib/issuer-auth';
import { env } from '../../../lib/env';
import { log, requestIdOf } from '../../../lib/logger';

import { isDraftState } from '../../../lib/draft-autosave';

const MAX_DRAFT_BYTES = 2.5 * 1024 * 1024;

/** Per-account autosaved session — recover a closed editor tab. */
export async function GET(request: Request) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

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
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  if (!env.DATABASE_URL) {
    return NextResponse.json({ detail: 'Database is not configured' }, { status: 503 });
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_DRAFT_BYTES) {
      return NextResponse.json({ detail: 'Draft too large to autosave' }, { status: 413 });
    }
    const body = JSON.parse(raw);
    if (!isDraftState(body?.state)) {
      return NextResponse.json({ detail: 'Invalid workspace draft' }, { status: 400 });
    }
    const state = { ...body.state, savedAt: new Date(body.state.savedAt).toISOString() };
    const updatedAt = new Date();

    await db
      .insert(workspaceDrafts)
      .values({ userId: user.userId, state, updatedAt })
      .onConflictDoUpdate({
        target: workspaceDrafts.userId,
        set: { state, updatedAt },
        setWhere: sql`COALESCE(${workspaceDrafts.state}->>'savedAt', '') <= ${state.savedAt}`,
      });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ detail: 'Invalid workspace draft' }, { status: 400 });
    }
    log.error('drafts', 'Failed to save workspace draft', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Failed to save draft' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

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
