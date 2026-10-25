import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import { unauthorizedResponse } from '../../../../lib/server-auth';
import { getAuthenticatedUser, toPublicUser, updateUserProfile } from '../../../../lib/accounts';

export async function PATCH(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorizedResponse('Invalid or expired token');

  let body: { name?: unknown; issuedByName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    return NextResponse.json({ detail: 'Name must be text' }, { status: 400 });
  }
  if (body.issuedByName !== undefined && typeof body.issuedByName !== 'string') {
    return NextResponse.json({ detail: 'Issuer name must be text' }, { status: 400 });
  }
  if (body.name === undefined && body.issuedByName === undefined) {
    return NextResponse.json({ detail: 'Nothing to update' }, { status: 400 });
  }

  try {
    const updated = await updateUserProfile(user.userId, {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.issuedByName === 'string' ? { issuedByName: body.issuedByName } : {}),
    });
    if (!updated) return unauthorizedResponse('Invalid or expired token');
    return NextResponse.json({ user: toPublicUser(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Name cannot be empty') {
      return NextResponse.json({ detail: message }, { status: 400 });
    }
    console.error('[Profile update error]:', error);
    return NextResponse.json({ detail: 'Failed to update profile' }, { status: 500 });
  }
}
