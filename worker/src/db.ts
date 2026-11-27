import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';

export type WorkerDb = NodePgDatabase<typeof schema>;

export function createWorkerDbPool(connectionString: string): { pool: pg.Pool; db: WorkerDb } {
  const parsed = new URL(connectionString);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  const sslMode = parsed.searchParams.get('sslmode');

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: !isLoopback && sslMode !== 'disable' ? { rejectUnauthorized: true } : undefined,
  });

  const db = drizzle(pool, { schema });
  return { pool, db };
}
