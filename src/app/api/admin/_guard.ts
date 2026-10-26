import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { unauthorizedResponse } from '../../../lib/server-auth';
import { getAuthenticatedUser } from '../../../lib/accounts';
import { getPlatformRole, type PlatformRole } from '../../../lib/platform-access';
import { env } from '../../../lib/env';

/**
 * Admin-console guard. Returns the caller's platform role, or null when the
 * caller is not an admin. Analytics endpoints expose AGGREGATES ONLY — never
 * recipient PII, certificate contents, or CSV data.
 */
export async function requireAdmin(
  request: Request
): Promise<{ userId: string; email: string; role: PlatformRole } | null> {
  const user = await getAuthenticatedUser(request);
  if (!user || !env.DATABASE_URL) return null;
  const role = await getPlatformRole(user.email);
  if (role !== 'admin' && role !== 'super_admin') return null;
  return { userId: user.userId, email: user.email, role };
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
