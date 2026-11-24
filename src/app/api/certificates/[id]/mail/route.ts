import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../../../lib/issuer-auth';
import { log, requestIdOf } from '../../../../../lib/logger';
import { reconcileMail } from '../../../../../lib/mail-delivery';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../../lib/server-auth';
import { isValidCertificateId } from '../../../../../lib/verification';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!isValidCertificateId(id) || typeof body?.found !== 'boolean'
    || (body.version !== null && (typeof body.version !== 'string' || !isValidCertificateId(body.version)))) {
    return NextResponse.json({ detail: 'Review this certificate in Gmail Sent first.' }, { status: 400 });
  }
  try {
    if (!await reconcileMail(user.userId, id, body.version, body.found)) {
      return NextResponse.json({ detail: 'The delivery changed or is unavailable. Refresh the event to check its status.' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('email', 'Could not save email review', { requestId: requestIdOf(request), userId: user.userId }, error);
    return NextResponse.json({ detail: 'Could not save this delivery review.' }, { status: 500 });
  }
}
