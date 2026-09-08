import { NextResponse } from 'next/server';
import { eq, or } from 'drizzle-orm';
import { db } from '../../../../../lib/db';
import { certificates } from '../../../../../db/schema';
import { getAdminUserFromRequest, unauthorizedResponse } from '../../../../../lib/server-auth';
import { hashToken, isValidCertificateId } from '../../../../../lib/verification';

/**
 * Revokes (or re-instates) a certificate by its public verification id or UUID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const username = getAdminUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Admin privilege required');
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
    const [cert] = await db
      .select({ id: certificates.id, status: certificates.status })
      .from(certificates)
      .where(or(eq(certificates.tokenHash, hashToken(id)), eq(certificates.id, id)))
      .limit(1);

    if (!cert) {
      return NextResponse.json({ detail: 'Certificate not found' }, { status: 404 });
    }

    if (cert.status === 'static') {
      return NextResponse.json(
        { detail: 'Static certificates cannot be revoked or reinstated' },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(certificates)
      .set({ status: reinstated ? 'issued' : 'revoked' })
      .where(eq(certificates.id, cert.id))
      .returning({ id: certificates.id, status: certificates.status });

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
