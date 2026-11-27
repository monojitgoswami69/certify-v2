import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  WORKER_HANDOFF_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'Must be 64 hex chars'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('https://wecertify.tech'),

  // Optional direct R2 read credentials (if buckets require authenticated S3 GET fallback)
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  // Dyno tuning & runtime bounds (calibrated for a single $7 Heroku Basic 512 MB dyno)
  DYNO: z.string().optional(),
  WORKER_ID: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2500),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(90),
  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(120).default(20),
  WORKER_SEND_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  WORKER_MEMORY_SOFT_LIMIT_MB: z.coerce.number().int().min(128).max(490).default(420),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(25_000).default(20_000),

  // Overridable OAuth/Gmail endpoints for isolated verification suites
  WORKER_GMAIL_API_BASE: z.string().url().default('https://gmail.googleapis.com'),
  WORKER_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  WORKER_OAUTH_USERINFO_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/userinfo'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema> & {
  resolvedDatabaseUrl: string;
  resolvedGoogleClientId: string;
  resolvedWorkerId: string;
};

let cachedDefaultWorkerId: string | null = null;

function defaultWorkerId(dyno?: string): string {
  if (!cachedDefaultWorkerId) {
    const tag = dyno || os.hostname();
    cachedDefaultWorkerId = `${tag}:${process.pid}:${randomBytes(3).toString('hex')}`;
  }
  return cachedDefaultWorkerId;
}

export function loadWorkerEnv(raw: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.parse(raw);
  const resolvedDatabaseUrl = parsed.WORKER_DATABASE_URL || (parsed.NODE_ENV === 'production' ? undefined : parsed.DATABASE_URL);
  if (!resolvedDatabaseUrl) {
    throw new Error('WORKER_DATABASE_URL (or DATABASE_URL in development) is required.');
  }
  const resolvedGoogleClientId = parsed.GOOGLE_CLIENT_ID || parsed.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!resolvedGoogleClientId) {
    throw new Error('GOOGLE_CLIENT_ID (or NEXT_PUBLIC_GOOGLE_CLIENT_ID) is required.');
  }
  if (parsed.WORKER_HEARTBEAT_SECONDS >= parsed.WORKER_LEASE_SECONDS) {
    throw new Error('WORKER_HEARTBEAT_SECONDS must be shorter than WORKER_LEASE_SECONDS.');
  }
  return {
    ...parsed,
    resolvedDatabaseUrl,
    resolvedGoogleClientId,
    resolvedWorkerId: parsed.WORKER_ID || defaultWorkerId(parsed.DYNO),
  };
}
