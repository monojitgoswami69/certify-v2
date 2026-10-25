import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { unauthorizedResponse, clearSessionCookie } from '../../../../lib/server-auth';
import { getAuthenticatedUser, revokeAllSessions } from '../../../../lib/accounts';

/**
 * Server-side logout: bumps `sessions_valid_after`, so every token issued
 * before this moment (including any copied out of localStorage by an XSS or
 * a shared machine) stops working immediately.
 */
export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return unauthorizedResponse('Invalid or expired token');
  }

  try {
    await revokeAllSessions(request);
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error('[Logout error]:', error);
    return NextResponse.json({ detail: 'Logout failed' }, { status: 500 });
  }
}
