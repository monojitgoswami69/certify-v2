type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = new Set([
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
  'code',
  'codeVerifier',
  'code_verifier',
  'recipientEmail',
  'senderEmail',
  'email',
  'rawBody',
  'rawResponse',
  'certificateContent',
  'pdfBuffer',
  'pngBuffer',
  'rawMime',
]);

function redactString(value: string): string {
  let safe = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  safe = safe.replace(/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]');
  safe = safe.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  return safe;
}

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      out[key] = redactString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

export function currentRssMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

export interface WorkerLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export function createWorkerLogger(
  workerId: string,
  sink: (level: LogLevel, line: string) => void = (level, line) => {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
): WorkerLogger {
  const emit = (level: LogLevel, message: string, meta: Record<string, unknown> = {}) => {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      service: 'wecertify-worker',
      workerId,
      rssMb: currentRssMb(),
      message: redactString(message),
      ...sanitizeMeta(meta),
    });
    sink(level, line);
  };

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}
