import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { requireAdmin, forbiddenResponse, ok } from '../_guard';

interface AccountRow {
  email: string;
  role: string;
  createdAt: string | null;
  eventCount: number;
  certificateCount: number;
  activeCount: number;
  revokedCount: number;
  totalViews: number;
  lastIssuedAt: string | null;
  lastActiveAt: string | null;
}

/**
 * Per-account high-level analytics. Aggregates only: counts and activity
 * dates. Recipient names, certificate contents, and CSV data are never
 * included — user data stays with the user.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  const result = await db.execute(sql`
    select
      u.email::text as email,
      coalesce(p.role, 'user')::text as role,
      to_char(u.created_at, 'YYYY-MM-DD') as created_at,
      (select count(*)::int from events e where e.user_id = u.id) as event_count,
      (select count(*)::int from certificates c where c.user_id = u.id) as certificate_count,
      (select count(*)::int from certificates c where c.user_id = u.id and c.status in ('issued','static')) as active_count,
      (select count(*)::int from certificates c where c.user_id = u.id and c.status = 'revoked') as revoked_count,
      (select coalesce(sum(c.scan_count), 0)::int from certificates c where c.user_id = u.id) as total_views,
      (select to_char(max(c.issued_at), 'YYYY-MM-DD') from certificates c where c.user_id = u.id) as last_issued_at,
      to_char(greatest(
        u.updated_at,
        coalesce((select max(c.issued_at) from certificates c where c.user_id = u.id), u.created_at)
      ), 'YYYY-MM-DD') as last_active_at
    from users u
    left join platform_access p on p.email = u.email
    order by u.created_at desc
  `);

  const rows = (result.rows ?? result) as unknown as AccountRow[];
  return ok({ accounts: rows });
}
