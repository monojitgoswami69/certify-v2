import { NextResponse } from 'next/server';
import { getAuthenticatedUser, type PublicUser } from './accounts';
import { ISSUANCE_REQUIRED_HEADER } from './access-role';
import { unauthorizedResponse } from './server-auth';

export function issuanceRequiredResponse() {
  return NextResponse.json(
    { detail: 'Certificate issuance access is required' },
    { status: 403, headers: { [ISSUANCE_REQUIRED_HEADER]: '1', 'Cache-Control': 'no-store' } }
  );
}

export async function requireIssuer(request: Request): Promise<
  { user: PublicUser; denial?: never } | { user?: never; denial: NextResponse }
> {
  const user = await getAuthenticatedUser(request);
  if (!user) return { denial: unauthorizedResponse() };
  if (!user.canIssueCertificates) return { denial: issuanceRequiredResponse() };
  return { user };
}
