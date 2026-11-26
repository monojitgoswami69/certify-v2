import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { unauthorizedResponse } from '../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../lib/accounts';
import { canManageAccess, type PlatformRole } from '../../../lib/access-role';
import { log, requestIdOf } from '../../../lib/logger';

export type AdminIdentity = { userId: string; email: string; role: Exclude<PlatformRole, 'user'> };

/**
 * Admin-console guard. Returns either the caller's admin identity or a clean
 * HTTP denial (`403` when unauthorized, `503` if auth storage is unreachable).
 * Analytics endpoints expose AGGREGATES ONLY — never recipient PII, certificate
 * contents, or CSV data.
 */
export async function authorizeAdmin(
  request: Request
): Promise<{ admin: AdminIdentity; denial?: never } | { admin?: never; denial: NextResponse }> {
  let user;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    log.error('admin', 'Failed to verify admin account', { requestId: requestIdOf(request) }, error);
    return {
      denial: NextResponse.json(
        { detail: 'Authentication service temporarily unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      ),
    };
  }
  if (!user || !canManageAccess(user.platformRole)) return { denial: forbiddenResponse() };
  return { admin: { userId: user.userId, email: user.email, role: user.platformRole } };
}

export async function requireAdmin(request: Request): Promise<AdminIdentity | null> {
  const result = await authorizeAdmin(request);
  return result.admin ?? null;
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ detail: 'Admin access required' }, { status: 403 });
}

/** Aggregate platform stats. One GROUP BY per concern; zero PII in, zero PII out. */
export async function loadOverview() {
  const [totals] = await db
    .select({
      accounts: sql<number>`(select count(*) from users)::int`,
      newAccounts30d: sql<number>`(select count(*) from users where created_at > now() - interval '30 days')::int`,
      events: sql<number>`(select count(*) from events)::int`,
      certificates: sql<number>`(select count(*) from certificates)::int`,
      activeCertificates: sql<number>`(select count(*) from certificates where status in ('issued','static'))::int`,
      revokedCertificates: sql<number>`(select count(*) from certificates where status = 'revoked')::int`,
      totalViews: sql<number>`(select coalesce(sum(scan_count), 0) from certificates)::int`,
      templates: sql<number>`(select count(*) from templates)::int`,
      batches: sql<number>`(select count(*) from registration_batches)::int`,
    })
    .from(sql`(select 1) as _`);

  const [activity] = await db
    .select({
      certs7d: sql<number>`(select count(*) from certificates where issued_at > now() - interval '7 days')::int`,
      certs30d: sql<number>`(select count(*) from certificates where issued_at > now() - interval '30 days')::int`,
    })
    .from(sql`(select 1) as _`);

  return { ...totals, ...activity };
}

export function ok(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export { unauthorizedResponse };
