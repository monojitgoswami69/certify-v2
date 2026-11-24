import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, forbiddenResponse, ok } from '../_guard';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../../lib/server-auth';
import {
  listPlatformAccess,
  addToPlatformAccess,
  removeFromPlatformAccess,
  updateIssuanceAccess,
  updateMailLimits,
} from '../../../../lib/platform-access';
import { MAX_MAILS_PER_MINUTE, MAX_MAILS_PER_SECOND } from '../../../../lib/mail-limits';

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const grantSchema = z.object({ email: emailSchema, role: z.enum(['user', 'admin']).default('user') });
const issuanceSchema = z.object({ email: emailSchema, canIssueCertificates: z.boolean() }).strict();
const limitsSchema = z.object({
  email: emailSchema,
  mailsPerMinute: z.number().int().min(1).max(MAX_MAILS_PER_MINUTE),
  mailsPerSecond: z.number().int().min(1).max(MAX_MAILS_PER_SECOND),
});

function accessDenied() {
  return NextResponse.json({ detail: 'You cannot change access for this account' }, { status: 403 });
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const result = grantSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    return NextResponse.json({ detail: 'Enter a valid email and role' }, { status: 400 });
  }

  const { email, role } = result.data;
  if (!await addToPlatformAccess(email, role, admin)) return accessDenied();
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function PUT(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const result = issuanceSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    return NextResponse.json({ detail: 'Enter a valid email and issuance permission' }, { status: 400 });
  }

  const { email, canIssueCertificates } = result.data;
  if (!await updateIssuanceAccess(email, canIssueCertificates, admin.role)) return accessDenied();
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function PATCH(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const admin = await requireAdmin(request);
  if (admin?.role !== 'super_admin') return accessDenied();

  const result = limitsSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    return NextResponse.json({
      detail: `Enter whole numbers from 1 to ${MAX_MAILS_PER_MINUTE} per minute and 1 to ${MAX_MAILS_PER_SECOND} per second`,
    }, { status: 400 });
  }
  const { email, ...limits } = result.data;
  if (!await updateMailLimits(email, limits)) {
    return NextResponse.json({ detail: 'Account is not on the access list' }, { status: 404 });
  }
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}

export async function DELETE(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const result = emailSchema.safeParse(new URL(request.url).searchParams.get('email'));
  if (!result.success) {
    return NextResponse.json({ detail: 'Enter a valid email address' }, { status: 400 });
  }
  if (!await removeFromPlatformAccess(result.data, admin.role)) return accessDenied();
  return ok({ access: await listPlatformAccess(), callerRole: admin.role });
}
