/**
 * Minimal structured logger.
 *
 * Emits single-line JSON (time, level, tag, message, request id when known,
 * stack for errors) so logs are greppable and ingestible without any
 * platform lock-in. Replace the internals with pino/Sentry later if needed —
 * keep the call sites stable.
 */

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
    entry.error = error.message;
    entry.stack = error.stack;
  } else if (error !== undefined) {
    entry.error = String(error);
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

/** Correlation id stamped on every request by src/proxy.ts. */
export function requestIdOf(request: Request): string | null {
  return request.headers.get('x-request-id');
}
