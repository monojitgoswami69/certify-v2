import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { log, requestIdOf } from '../../../../lib/logger';
import { getOwnedBatchSummary } from '../../../../lib/mail-batches';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const { batchId } = await params;
  try {
    const batch = await getOwnedBatchSummary(user.userId, batchId);
    if (!batch) {
      return NextResponse.json({ detail: 'Batch not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ batch }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    log.error('mail-batches', 'Failed to inspect batch', { requestId: requestIdOf(request), userId: user.userId, batchId }, error);
    return NextResponse.json({ detail: 'Could not load batch status.' }, { status: 500 });
  }
}
