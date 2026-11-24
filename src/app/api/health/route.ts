import { log } from '../../../lib/logger';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { env } from '../../../lib/env';

/**
 * Unauthenticated liveness/readiness probe for load balancers, uptime
 * monitors, and container orchestrators. Also verifies the database is
 * reachable so a "healthy" process with a dead DB is still detectable.
 */
export async function GET() {
  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, db: 'not-configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, db: 'up' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    log.warn('health', 'Database health check failed', {}, error);
    return NextResponse.json(
      { ok: false, db: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
