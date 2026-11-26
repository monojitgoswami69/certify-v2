/**
 * Parallel certificate generation with concurrency bounded by CPU and template memory.
 * Workers remain warm across chunks, sharing the template Blob with zero-copy.
 */

import type { TextBox, CsvRow, ImageElement } from '../types';
import type { QrPlacement, OutputFormat, BatchResultItem } from './certificate-worker';
import type { WorkerFontData } from './font-loader';
import { computeExportScale, EXPORT_JPEG_QUALITY } from './export-scale';

export type { OutputFormat, BatchResultItem, WorkerFontData };

export interface WorkerTask {
  id: number;
  rowIndex: number;
  row: CsvRow;
  filename: string;
  verificationUrl?: string;
}

export class CertificateWorkerPool {
  private workers: Worker[] = [];
  private failedWorkers = new Map<Worker, string>();
  private pendingResolves: Array<() => void> = [];
  private terminated = false;

  /**
   * Concurrency is configured to (cores - 1) to saturate available multi-core hardware
   * while keeping 1 core dedicated to the main thread for smooth 60 FPS UI interaction.
   */
  static getOptimalWorkerCount(width: number, height: number): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const memory = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
      : 4;
    const exportScale = computeExportScale(width, height);
    const scaledPixels = Math.max(1, width * exportScale * height * exportScale);
    const bufferCount = scaledPixels >= 8_000_000 ? 1 : 2;
    // Each worker decodes the source template once at native size and keeps 1 or 2 supersampled RGBA canvases.
    const bytesPerWorker = Math.max(1, width * height) * 4 + scaledPixels * 4 * bufferCount;
    const budget = (memory <= 4 ? 96 : 192) * 1024 ** 2;
    return Math.max(1, Math.min(cores - 1, 8, Math.floor(budget / bytesPerWorker)));
  }

  static isSupported(): boolean {
    try {
      if (
        typeof window === 'undefined' ||
        typeof Worker === 'undefined' ||
        typeof OffscreenCanvas === 'undefined' ||
        typeof createImageBitmap === 'undefined' ||
        typeof OffscreenCanvas.prototype.convertToBlob !== 'function'
      ) {
        return false;
      }
      // Guarantee that 2D rendering context is actually implementable on this platform's OffscreenCanvas
      // (guards against Safari < 16.4 or older WebKit stubs)
      const testCanvas = new OffscreenCanvas(1, 1);
      const ctx = testCanvas.getContext('2d');
      return !!ctx;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the worker pool.
   *
   * Transfers the template Blob reference — each worker decodes it once into an ImageBitmap.
   * Font binary buffers are cloned independently for each worker so they can register FontFaces.
   */
  async initialize(
    templateFile: Blob,
    templateWidth: number,
    templateHeight: number,
    boxes: TextBox[],
    qrZones: QrPlacement[],
    formats: OutputFormat[],
    fonts?: WorkerFontData[],
    maxWorkers?: number,
    images?: ImageElement[]
  ): Promise<number> {
    this.terminate();
    this.terminated = false;

    const optimal = CertificateWorkerPool.getOptimalWorkerCount(templateWidth, templateHeight);
    const workerCount = Math.max(1, Math.min(maxWorkers ?? optimal, optimal));
    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('./certificate-worker.ts', import.meta.url),
        { type: 'module' }
      );

      const initPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Worker ${i} initialization timed out`));
        }, 20000);

        const cleanup = () => {
          clearTimeout(timeout);
          worker.removeEventListener('message', onReady);
          worker.removeEventListener('error', onError);
        };

        const cancel = () => {
          cleanup();
          resolve();
        };

        const onReady = (event: MessageEvent) => {
          if (event.data.type === 'ready') {
            cleanup();
            if (event.data.result?.error) {
              reject(new Error(event.data.result.error));
            } else {
              resolve();
            }
          }
        };

        const onError = (event: ErrorEvent) => {
          cleanup();
          reject(new Error(`Worker ${i} error: ${event.message}`));
        };

        worker.addEventListener('message', onReady);
        worker.addEventListener('error', onError);

        this.pendingResolves.push(cancel);
      });

      this.workers.push(worker);
      initPromises.push(initPromise);

      const clonedFonts = fonts
        ? fonts.map((f) => ({
            family: f.family,
            buffer: f.buffer.slice(0),
            weight: f.weight,
            style: f.style,
          }))
        : undefined;
      const transferables = clonedFonts ? clonedFonts.map((f) => f.buffer) : [];

      worker.postMessage(
        {
          type: 'init',
          templateBlob: templateFile,
          templateWidth,
          templateHeight,
          boxes,
          qrZones,
          images,
          formats,
          jpegQuality: EXPORT_JPEG_QUALITY,
          fonts: clonedFonts,
        },
        transferables
      );
    }

    try {
      await Promise.all(initPromises);
      this.pendingResolves = [];
      return workerCount;
    } catch (err) {
      this.terminate();
      throw err;
    }
  }

  /**
   * Process a chunk dynamically across healthy workers using work-stealing micro-batches.
   * Healthy workers absorb work from slower or crashed workers, and crashed workers are
   * excluded from subsequent chunks so one bad worker never poisons later batches.
   */
  async processChunk(
    tasks: WorkerTask[],
    onResult?: (result: BatchResultItem, completedInChunk: number, totalInChunk: number) => void
  ): Promise<void> {
    if (tasks.length === 0) return;
    if (this.workers.length === 0) throw new Error('Worker pool not initialized');

    const healthyWorkers = this.workers.filter((w) => !this.failedWorkers.has(w));
    if (healthyWorkers.length === 0) {
      throw new Error('All certificate workers have failed');
    }

    const pendingQueue: WorkerTask[] = [...tasks];
    const settledTaskIds = new Set<number>();
    const retriedTaskIds = new Set<number>();
    const totalCount = tasks.length;
    let completedCount = 0;
    let inFlightWorkers = 0;
    let lastFailureError = 'Certificate rendering failed';
    const queueWaiters: Array<() => void> = [];

    const wakeAll = () => {
      while (queueWaiters.length > 0) {
        queueWaiters.shift()!();
      }
    };

    const emitSettled = (result: BatchResultItem) => {
      if (settledTaskIds.has(result.id)) return;
      settledTaskIds.add(result.id);
      completedCount++;
      onResult?.(result, completedCount, totalCount);
    };

    const nextMicroBatch = (): WorkerTask[] => {
      const remaining = pendingQueue.length;
      if (remaining === 0) return [];
      const aliveCount = Math.max(1, this.workers.filter((w) => !this.failedWorkers.has(w)).length);
      const batchSize =
        remaining <= aliveCount * 2
          ? 1
          : Math.min(4, Math.max(1, Math.floor(remaining / (aliveCount * 2))));
      return pendingQueue.splice(0, batchSize);
    };

    const runMicroBatch = (worker: Worker, batch: WorkerTask[]): Promise<void> =>
      new Promise<void>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;

        const finishMicroBatch = (error: string, failed: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();

          if (failed) {
            lastFailureError = error;
            this.failedWorkers.set(worker, error);
            worker.terminate();
          }

          const hasHealthyReplacement = this.workers.some((w) => !this.failedWorkers.has(w));
          for (const task of batch) {
            if (settledTaskIds.has(task.id)) continue;
            if (failed && hasHealthyReplacement && !retriedTaskIds.has(task.id)) {
              retriedTaskIds.add(task.id);
              pendingQueue.push(task);
            } else {
              emitSettled({
                id: task.id,
                rowIndex: task.rowIndex,
                filename: task.filename,
                error,
              });
            }
          }
          resolve();
        };

        const restartTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(() => finishMicroBatch('Certificate rendering timed out', true), 90_000);
        };

        const cancel = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };

        const handler = (event: MessageEvent) => {
          if (event.data.type === 'itemComplete') {
            const result: BatchResultItem = event.data.result;
            emitSettled(result);
            restartTimer();
          } else if (event.data.type === 'batchComplete') {
            finishMicroBatch('Worker finished without returning this certificate', false);
          }
        };

        const errorHandler = (event: ErrorEvent) =>
          finishMicroBatch(event.message || 'Worker thread execution error', true);
        const messageErrorHandler = () =>
          finishMicroBatch('Cannot read the worker output', true);

        const cleanup = () => {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          worker.removeEventListener('error', errorHandler);
          worker.removeEventListener('messageerror', messageErrorHandler);
        };

        this.pendingResolves.push(cancel);
        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);
        worker.addEventListener('messageerror', messageErrorHandler);
        restartTimer();

        worker.postMessage({
          type: 'generateBatch',
          items: batch.map((t) => ({
            id: t.id,
            rowIndex: t.rowIndex,
            row: t.row,
            filename: t.filename,
            verificationUrl: t.verificationUrl,
          })),
        });
      });

    const workerLoops = healthyWorkers.map(async (worker) => {
      while (!this.terminated && !this.failedWorkers.has(worker)) {
        const batch = nextMicroBatch();
        if (batch.length === 0) {
          if (inFlightWorkers === 0) break;
          await new Promise<void>((r) => {
            queueWaiters.push(r);
            this.pendingResolves.push(r);
          });
          continue;
        }
        inFlightWorkers++;
        try {
          await runMicroBatch(worker, batch);
        } finally {
          inFlightWorkers--;
          wakeAll();
        }
      }
    });

    await Promise.all(workerLoops);
    this.pendingResolves = [];

    if (!this.terminated) {
      while (pendingQueue.length > 0) {
        const leftover = pendingQueue.shift()!;
        emitSettled({
          id: leftover.id,
          rowIndex: leftover.rowIndex,
          filename: leftover.filename,
          error: lastFailureError,
        });
      }
    }
  }

  terminate(): void {
    this.terminated = true;
    for (const resolve of this.pendingResolves) {
      resolve();
    }
    this.pendingResolves = [];

    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.failedWorkers.clear();
  }
}
