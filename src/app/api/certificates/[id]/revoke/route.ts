import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { certificates } from '../../../../../db/schema';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../../lib/server-auth';
import { hashToken, isValidCertificateId } from '../../../../../lib/verification';

/**
 * Revokes (or re-instates) a certificate by its public verification id.
 * JWT-protected; intended for admin/scripted use until a management UI exists.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired token');
  }

  const { id } = await params;
  if (!isValidCertificateId(id)) {
    return NextResponse.json({ detail: 'Invalid certificate id' }, { status: 400 });
  }

  let reinstated = false;
  try {
    const body = await request.json().catch(() => ({}));
    reinstated = Boolean(body?.reinstate);
  } catch {
    // no body -> revoke
  }

  try {
    const [updated] = await db
      .update(certificates)
      .set({ status: reinstated ? 'issued' : 'revoked' })
      .where(eq(certificates.tokenHash, hashToken(id)))
      .returning({ id: certificates.id, status: certificates.status });

    if (!updated) {
      return NextResponse.json({ detail: 'Certificate not found' }, { status: 404 });
    }

    return NextResponse.json({
      id,
      status: updated.status,
      message: reinstated ? 'Certificate reinstated' : 'Certificate revoked',
    });
  } catch (error) {
    console.error('[Certificate revoke error]:', error);
    return NextResponse.json({ detail: 'Failed to update certificate' }, { status: 500 });
  }
}
