import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { platformAccess } from '../db/schema';
import { env } from './env';
import type { MailLimits } from './mail-limits';
import type { PlatformPermissions, PlatformRole } from './access-role';

export type { PlatformRole } from './access-role';
export type ManagedRole = Exclude<PlatformRole, 'super_admin'>;

export async function getPlatformPermissions(email: string): Promise<PlatformPermissions | null> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select({ role: platformAccess.role, canIssueCertificates: platformAccess.canIssueCertificates })
    .from(platformAccess)
    .where(eq(platformAccess.email, normalized))
    .limit(1);
  if (normalized === env.ADMIN_EMAIL) {
    return { platformRole: 'super_admin', canIssueCertificates: row?.canIssueCertificates === true };
  }
  if (!row || !['admin', 'user', 'super_admin'].includes(row.role)) return null;
  return { platformRole: row.role === 'admin' ? 'admin' : 'user', canIssueCertificates: row.canIssueCertificates };
}

export async function ensureSuperAdminRow(): Promise<void> {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) return;
  await db.insert(platformAccess).values({ email: adminEmail, role: 'super_admin' })
    .onConflictDoNothing({ target: platformAccess.email });
}

export async function listPlatformAccess() {
  await ensureSuperAdminRow();
  const rows = await db
    .select({
      email: platformAccess.email,
      role: platformAccess.role,
      canIssueCertificates: platformAccess.canIssueCertificates,
      createdAt: platformAccess.createdAt,
      mailsPerMinute: platformAccess.mailsPerMinute,
      mailsPerSecond: platformAccess.mailsPerSecond,
    })
    .from(platformAccess)
    .orderBy(sql`${platformAccess.createdAt} desc`);
  const rootEmail = env.ADMIN_EMAIL;
  return rows.map((row) => ({
    ...row,
    role: row.email === rootEmail ? 'super_admin' : row.role === 'admin' ? 'admin' : 'user',
  }));
}

export async function addToPlatformAccess(
  email: string,
  role: ManagedRole,
  actor: { userId: string; role: PlatformRole }
): Promise<boolean> {
  if (email === env.ADMIN_EMAIL || (role === 'admin' && actor.role !== 'super_admin')) return false;
  const rows = await db.insert(platformAccess).values({ email, role, addedBy: actor.userId })
    .onConflictDoUpdate({
      target: platformAccess.email,
      set: { role, addedBy: actor.userId, updatedAt: new Date() },
      setWhere: actor.role === 'super_admin' ? undefined : ne(platformAccess.role, 'admin'),
    })
    .returning({ email: platformAccess.email });
  return rows.length > 0;
}

export async function updateMailLimits(email: string, limits: MailLimits): Promise<boolean> {
  if (email === env.ADMIN_EMAIL) await ensureSuperAdminRow();
  const rows = await db.update(platformAccess).set({ ...limits, updatedAt: new Date() })
    .where(eq(platformAccess.email, email))
    .returning({ email: platformAccess.email });
  return rows.length > 0;
}

export async function updateIssuanceAccess(
  email: string,
  canIssueCertificates: boolean,
  callerRole: Exclude<PlatformRole, 'user'>
): Promise<boolean> {
  if (email === env.ADMIN_EMAIL) {
    if (callerRole !== 'super_admin') return false;
    await ensureSuperAdminRow();
  }
  const target = and(
    eq(platformAccess.email, email),
    callerRole === 'super_admin' ? undefined : ne(platformAccess.role, 'admin')
  );
  const rows = await db.update(platformAccess).set({ canIssueCertificates, updatedAt: new Date() })
    .where(target)
    .returning({ email: platformAccess.email });
  return rows.length > 0;
}

export async function removeFromPlatformAccess(email: string, callerRole: PlatformRole): Promise<boolean> {
  if (email === env.ADMIN_EMAIL) return false;
  const canRemove = and(
    eq(platformAccess.email, email),
    callerRole === 'super_admin' ? undefined : ne(platformAccess.role, 'admin')
  );
  const result = await db.execute(sql`
    WITH removed AS (
      DELETE FROM platform_access WHERE ${canRemove} RETURNING email
    ), revoked AS (
      UPDATE users SET sessions_valid_after = clock_timestamp(), updated_at = now()
      FROM removed WHERE users.email = removed.email RETURNING users.id
    )
    SELECT EXISTS (SELECT 1 FROM removed) AS removed
  `);
  return result.rows[0]?.removed === true;
}
