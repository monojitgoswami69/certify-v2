import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { log, requestIdOf } from '../../../../../lib/logger';
import { cancelOwnedMailBatch, MailBatchError } from '../../../../../lib/mail-batches';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../../lib/server-auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { batchId } = await params;
  try {
    const batch = await cancelOwnedMailBatch(user.userId, batchId);
    return NextResponse.json({ batch }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MailBatchError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    log.error('mail-batches', 'Failed to cancel batch', { requestId: requestIdOf(request), userId: user.userId, batchId }, error);
    return NextResponse.json({ detail: 'Could not cancel background batch.' }, { status: 500 });
  }
}
