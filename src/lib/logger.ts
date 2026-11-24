/**
 * Minimal structured logger.
 *
 * Emits single-line JSON (time, level, tag, message, request id when known,
 * error type when applicable) so logs are greppable and ingestible without any
 * platform lock-in. Replace the internals with pino/Sentry later if needed —
 * keep the call sites stable.
 */

import { randomUUID } from 'node:crypto';
import { DrizzleQueryError } from 'drizzle-orm';
import { NeonDbError } from '@neondatabase/serverless';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  requestId?: string | null;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: Level, tag: string, message: string, meta: LogMeta = {}, error?: unknown) {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    tag,
    message,
    ...meta,
  };
  if (error instanceof Error) {
    // Never include database messages, stacks, SQL, or bound parameter values.
    const cause = error instanceof DrizzleQueryError ? error.cause : error;
    entry.error = error.name;
    if (cause instanceof NeonDbError && cause.code) entry.databaseCode = cause.code;
  }
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (tag: string, message: string, meta?: LogMeta, error?: unknown) =>
    emit('debug', tag, message, meta, error),
  info: (tag: string, message: string, meta?: LogMeta, error?: unknown) =>
    emit('info', tag, message, meta, error),
  warn: (tag: string, message: string, meta?: LogMeta, error?: unknown) =>
    emit('warn', tag, message, meta, error),
  error: (tag: string, message: string, meta?: LogMeta, error?: unknown) =>
    emit('error', tag, message, meta, error),
};

/** Server-side correlation ID for a request. */
const requestIds = new WeakMap<Request, string>();

export function requestIdOf(request: Request): string {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const id = randomUUID();
  requestIds.set(request, id);
  return id;
}
