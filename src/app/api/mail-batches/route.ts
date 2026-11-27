import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../lib/issuer-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../lib/server-auth';
import { log, requestIdOf } from '../../../lib/logger';
import {
  enqueueMailBatch,
  getEventBatchStatus,
  isBackgroundWorkerEnabled,
  MailBatchError,
} from '../../../lib/mail-batches';

export async function GET(request: Request) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const eventId = new URL(request.url).searchParams.get('eventId')?.trim() ?? '';
  if (!eventId) {
    return NextResponse.json(
      { enabled: isBackgroundWorkerEnabled(), latestBatch: null, recentBatches: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const status = await getEventBatchStatus(user.userId, eventId);
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MailBatchError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    log.error('mail-batches', 'Failed to read batch status', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Could not load background mailing status.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`mail-batch:enqueue:${user.userId}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many batch queue requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  try {
    const result = await enqueueMailBatch({
      user,
      eventId: typeof body.eventId === 'string' ? body.eventId.trim() : '',
      certificateIds: body.certificateIds,
      mailPreferences: body.mailPreferences,
      allowResend: body.allowResend === true,
    });
    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof MailBatchError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    log.error('mail-batches', 'Failed to enqueue mail batch', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Could not enqueue background mail batch.' }, { status: 500 });
  }
}
