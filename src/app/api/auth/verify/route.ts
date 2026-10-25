import { NextResponse } from 'next/server';
import { unauthorizedResponse } from '../../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../../lib/accounts';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired token');
  }

  return NextResponse.json({
    authenticated: true,
    user,
  });
}
