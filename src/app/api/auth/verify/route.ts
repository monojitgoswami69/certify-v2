import { NextResponse } from 'next/server';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../../lib/server-auth';

export async function GET(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired token');
  }

  return NextResponse.json({
    authenticated: true,
    username,
  });
}
