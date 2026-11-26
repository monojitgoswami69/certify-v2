/**
 * Server-side environment contract.
 *
 * Single source of truth for every configuration value the server reads.
 * Values are parsed lazily (never at import time — `next build` must work
 * without secrets) and validated once; a bad or missing variable produces one
 * clear, aggregated error instead of a mystery 500 three layers deep.
 *
 * Server-only. Client code keeps reading process.env.NEXT_PUBLIC_* directly
 * (those are inlined at build time and must not pull this module into the
 * browser bundle).
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Core infrastructure
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.string().email()).optional(),
  AUTH_PASSWORD: z.string().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GMAIL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional(),

  // Networking
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).default(1),

  // Branding
  ISSUED_BY: z.string().optional(),
  NEXT_PUBLIC_ISSUED_BY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  VERIFY_MAINTENANCE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  // Cloudflare R2 object storage (optional; falls back to inline Postgres data URLs <= 3 MB when unset)
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses on every access (uncached): the object is tiny so validation costs
 * microseconds, and it keeps the values live for tests that stub
 * process.env between cases.
 */
function getEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nFix these variables in .env (see .env.example) and restart.`);
  }
  return result.data;
}

/**
 * Validated environment. Throws a descriptive error on first access when the
 * configuration is invalid — routes surface this as a 500 with the reason.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return (getEnv() as unknown as Record<string, unknown>)[prop];
  },
});

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === 'development';
}

/** The Google OAuth client id, accepting either the public or server-only name. */
export function googleClientId(): string {
  const e = getEnv();
  return e.NEXT_PUBLIC_GOOGLE_CLIENT_ID || e.GOOGLE_CLIENT_ID || '';
}

/**
 * Production startup assertions. Called lazily by the features that need each
 * variable, so a missing optional feature (e.g. Gmail) degrades gracefully
 * while a truly broken required setup fails loudly with one message.
 */
export function assertProductionConfig(): void {
  if (!isProduction()) return;
  const e = getEnv();
  const problems: string[] = [];
  if (!e.JWT_SECRET || e.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to at least 32 characters in production');
  }
  if (!e.DATABASE_URL) problems.push('DATABASE_URL must be set in production');
  if (problems.length > 0) {
    throw new Error(`Refusing to run with an insecure production configuration:\n  ${problems.join('\n  ')}`);
  }
}
