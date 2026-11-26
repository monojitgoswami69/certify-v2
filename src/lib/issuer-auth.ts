import { NextResponse } from 'next/server';
import { getAuthenticatedUser, type PublicUser } from './accounts';
import { ISSUANCE_REQUIRED_HEADER } from './access-role';
import { unauthorizedResponse } from './server-auth';
import { log, requestIdOf } from './logger';

export function issuanceRequiredResponse() {
  return NextResponse.json(
    { detail: 'Certificate issuance access is required' },
    { status: 403, headers: { [ISSUANCE_REQUIRED_HEADER]: '1', 'Cache-Control': 'no-store' } }
  );
}

export async function requireIssuer(request: Request): Promise<
  { user: PublicUser; denial?: never } | { user?: never; denial: NextResponse }
> {
  let user: PublicUser | null;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    log.error('auth', 'Failed to load issuer account', { requestId: requestIdOf(request) }, error);
    return {
      denial: NextResponse.json(
        { detail: 'Authentication service temporarily unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      ),
    };
  }
  if (!user) return { denial: unauthorizedResponse() };
  if (!user.canIssueCertificates) return { denial: issuanceRequiredResponse() };
  return { user };
}
