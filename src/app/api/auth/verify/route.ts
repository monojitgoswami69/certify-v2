import { NextResponse } from 'next/server';
import { unauthorizedResponse } from '../../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../../lib/accounts';
import { log, requestIdOf } from '../../../../lib/logger';

export async function GET(request: Request) {
  let user;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    log.error('auth', 'Failed to verify session', { requestId: requestIdOf(request) }, error);
    return NextResponse.json(
      { detail: 'Authentication service temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!user) {
    return unauthorizedResponse('Invalid or expired token');
  }

  return NextResponse.json({
    authenticated: true,
    user,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
