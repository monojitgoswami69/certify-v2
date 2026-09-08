/**
 * Neon Postgres client (Drizzle over the stateless neon-http driver).
 *
 * The client is created lazily on first query so that `next build` (which
 * bundles route modules without a live DATABASE_URL) never fails. A singleton
 * is cached on globalThis so Next.js dev hot-reload does not create a new
 * client per module evaluation.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../db/schema';

type CertifyDb = NeonHttpDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  certifyDrizzle?: CertifyDb;
  certifyDbUrl?: string;
};

function getDb(): CertifyDb {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Configure your Neon connection string.');
  }
  if (!globalForDb.certifyDrizzle || globalForDb.certifyDbUrl !== connectionString) {
    globalForDb.certifyDrizzle = drizzle(neon(connectionString), { schema });
    globalForDb.certifyDbUrl = connectionString;
  }
  return globalForDb.certifyDrizzle;
}

/**
 * Lazy proxy: forwards every drizzle call (select/insert/update/batch/…) to
 * the real client, creating it on first use.
 */
export const db = new Proxy({} as CertifyDb, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
}) as CertifyDb;
