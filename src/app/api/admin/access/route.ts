import { NextResponse } from 'next/server';
import { requireAdmin, forbiddenResponse, ok } from '../_guard';
import {
  listPlatformAccess,
  addToPlatformAccess,
  removeFromPlatformAccess,
  isPlatformRole,
  type PlatformRole,
} from '../../../../lib/platform-access';

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** Allowlist management. Admins manage users; only super admins manage admins. */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role ?? 'user';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ detail: 'Enter a valid email address' }, { status: 400 });
  }
  if (!isPlatformRole(role)) {
    return NextResponse.json({ detail: 'Invalid role' }, { status: 400 });
  }

  const requested = role as PlatformRole;
  if (requested === 'super_admin' && admin.role !== 'super_admin') {
    return NextResponse.json(
      { detail: 'Only the super admin can grant super admin access' },
      { status: 403 }
    );
  }
  // Admins can only add regular users; super admins can add admins too.
  const effectiveRole: PlatformRole =
    requested === 'super_admin' ? 'super_admin' : requested === 'admin' && admin.role === 'super_admin' ? 'admin' : 'user';

  await addToPlatformAccess(email, effectiveRole, admin.userId);
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email) {
    return NextResponse.json({ detail: 'email query parameter is required' }, { status: 400 });
  }

  const removed = await removeFromPlatformAccess(email);
  if (!removed) {
    return NextResponse.json(
      { detail: 'Cannot remove this account (root admin, or not on the list)' },
      { status: admin.role === 'super_admin' ? 400 : 403 }
    );
  }
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}
