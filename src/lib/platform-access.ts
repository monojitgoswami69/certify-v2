/**
 * Platform access allowlist + role model (server-only).
 *
 * Only emails added by an admin can sign in. Roles:
 *   'user'        — normal platform access
 *   'admin'       — can access /admin, manage the allowlist (users only)
 *   'super_admin' — everything admins can do, plus granting admin roles
 *
 * The ADMIN_EMAIL account bootstraps as super_admin on first sign-in; every
 * pre-existing account was grandfathered as 'user' by migration 0005.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { platformAccess } from '../db/schema';
import { env } from './env';

export type PlatformRole = 'user' | 'admin' | 'super_admin';

const VALID_ROLES: PlatformRole[] = ['user', 'admin', 'super_admin'];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getPlatformRole(email: string): Promise<PlatformRole | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const adminEmail = env.ADMIN_EMAIL ?? null;

  try {
    const [row] = await db
      .select({ role: platformAccess.role })
      .from(platformAccess)
      .where(eq(platformAccess.email, normalized))
      .limit(1);
    if (row && isPlatformRole(row.role)) return row.role;
  } catch (err) {
    console.warn('[platform-access] lookup failed:', err);
  }

  // Bootstrap: the env-configured admin always has super_admin access, even
  // before its allowlist row exists. The row is created lazily on sign-in.
  if (adminEmail && normalized === adminEmail) return 'super_admin';
  return null;
}

/** Ensures the env-configured admin has a super_admin allowlist row. */
export async function ensureSuperAdminRow(): Promise<void> {
  const adminEmail = env.ADMIN_EMAIL ?? null;
  if (!adminEmail) return;
  try {
    await db
      .insert(platformAccess)
      .values({ email: adminEmail, role: 'super_admin' })
      .onConflictDoUpdate({
        target: platformAccess.email,
        set: { role: 'super_admin', updatedAt: new Date() },
      });
  } catch (err) {
    console.warn('[platform-access] super admin bootstrap failed:', err);
  }
}

export async function listPlatformAccess(): Promise<
  Array<{ email: string; role: PlatformRole; createdAt: Date }>
> {
  const rows = await db
    .select({ email: platformAccess.email, role: platformAccess.role, createdAt: platformAccess.createdAt })
    .from(platformAccess)
    .orderBy(sql`${platformAccess.createdAt} desc`);
  return rows.map((r) => ({
    email: r.email,
    role: isPlatformRole(r.role) ? r.role : 'user',
    createdAt: r.createdAt,
  }));
}

export async function addToPlatformAccess(
  email: string,
  role: PlatformRole,
  addedByUserId: string
): Promise<void> {
  await db
    .insert(platformAccess)
    .values({ email: normalizeEmail(email), role, addedBy: addedByUserId })
    .onConflictDoUpdate({
      target: platformAccess.email,
      set: { role, addedBy: addedByUserId, updatedAt: new Date() },
    });
}

export async function removeFromPlatformAccess(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const adminEmail = env.ADMIN_EMAIL ?? null;
  if (adminEmail && normalized === adminEmail) return false; // the root admin cannot be removed
  const deleted = await db
    .delete(platformAccess)
    .where(eq(platformAccess.email, normalized))
    .returning({ email: platformAccess.email });
  return deleted.length > 0;
}
