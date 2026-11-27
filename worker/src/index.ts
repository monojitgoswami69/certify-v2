import { createWorkerDbPool } from './db.js';
import { loadWorkerEnv } from './env.js';
import { createWorkerLogger } from './logger.js';
import { processSingleQueuedBatch } from './processor.js';

function waitPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

async function main() {
  const env = loadWorkerEnv();
  const logger = createWorkerLogger(env.resolvedWorkerId);
  const { pool, db } = createWorkerDbPool(env.resolvedDatabaseUrl);
  pool.on('error', (error) => {
    logger.warn('Idle database connection was lost', { error: error.name });
  });
  const shutdown = new AbortController();
  let shutdownTimer: NodeJS.Timeout | undefined;

  const initiateShutdown = (signalName: string) => {
    if (shutdown.signal.aborted) return;
    logger.info('Received shutdown signal; stopping new claims cleanly', { signal: signalName });
    shutdown.abort();
    shutdownTimer = setTimeout(() => {
      logger.warn('Worker shutdown grace period elapsed; lease recovery will inspect outstanding work');
      process.exit(0);
    }, env.WORKER_SHUTDOWN_GRACE_MS).unref();
  };

  process.once('SIGTERM', () => initiateShutdown('SIGTERM'));
  process.once('SIGINT', () => initiateShutdown('SIGINT'));

  logger.info('Worker started', {
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    sendConcurrency: env.WORKER_SEND_CONCURRENCY,
    memorySoftLimitMb: env.WORKER_MEMORY_SOFT_LIMIT_MB,
  });

  try {
    while (!shutdown.signal.aborted) {
      let didWork = false;
      try {
        didWork = await processSingleQueuedBatch({
          pool,
          db,
          env,
          logger,
          shutdownSignal: shutdown.signal,
        });
      } catch (error) {
        logger.error('Worker poll iteration error', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }

      if (!didWork && !shutdown.signal.aborted) {
        await waitPoll(env.WORKER_POLL_INTERVAL_MS, shutdown.signal);
      }
    }
  } finally {
    await pool.end().catch(() => {});
    clearTimeout(shutdownTimer);
    logger.info('Worker exited cleanly');
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      service: 'wecertify-worker',
      message: 'Worker startup failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  );
  process.exit(1);
});
