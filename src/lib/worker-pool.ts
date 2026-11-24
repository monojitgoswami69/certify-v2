/**
 * Parallel certificate generation with concurrency bounded by CPU and template memory.
 * Workers remain warm across chunks, sharing the template Blob with zero-copy.
 */

import type { TextBox, CsvRow, ImageElement } from '../types';
import type { QrPlacement, OutputFormat, BatchResultItem } from './certificate-worker';
import type { WorkerFontData } from './font-loader';

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

  /**
   * Concurrency is configured to (cores - 1) to saturate available multi-core hardware
   * while keeping 1 core dedicated to the main thread for smooth 60 FPS UI interaction.
   */
  static getOptimalWorkerCount(width: number, height: number): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const memory = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
      : 4;
    // Each worker decodes the template and typically keeps two RGBA buffers.
    const bytesPerWorker = Math.max(1, width * height) * 4 * 3;
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
          reject(new Error(`Worker ${i} initialization timed out`));
        }, 20000);

        const onReady = (event: MessageEvent) => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            worker.removeEventListener('message', onReady);
            worker.removeEventListener('error', onError);

            if (event.data.result?.error) {
              reject(new Error(event.data.result.error));
            } else {
              resolve();
            }
          }
        };

        const onError = (event: ErrorEvent) => {
          clearTimeout(timeout);
          worker.removeEventListener('message', onReady);
          worker.removeEventListener('error', onError);
          reject(new Error(`Worker ${i} error: ${event.message}`));
        };

        worker.addEventListener('message', onReady);
        worker.addEventListener('error', onError);

        this.pendingResolves.push(resolve);
      });

      this.workers.push(worker);
      initPromises.push(initPromise);

      worker.postMessage({
        type: 'init',
        templateBlob: templateFile,
        templateWidth,
        templateHeight,
        boxes,
        qrZones,
        images,
        formats,
        jpegQuality: 0.92,
        fonts: fonts
          ? fonts.map((f) => ({
              family: f.family,
              buffer: f.buffer.slice(0),
              weight: f.weight,
              style: f.style,
            }))
          : undefined,
      });
    }

    await Promise.all(initPromises);
    this.pendingResolves = [];
    return workerCount;
  }

  /**
   * Process a chunk of tasks evenly distributed across all active workers in parallel.
   */
  async processChunk(
    tasks: WorkerTask[],
    onResult?: (result: BatchResultItem, completedInChunk: number, totalInChunk: number) => void
  ): Promise<void> {
    if (tasks.length === 0) return;
    if (this.workers.length === 0) throw new Error('Worker pool not initialized');

    const workerCount = this.workers.length;
    const tasksPerWorker = Math.ceil(tasks.length / workerCount);

    const workerBatches: WorkerTask[][] = [];
    for (let i = 0; i < workerCount; i++) {
      const start = i * tasksPerWorker;
      const end = Math.min(start + tasksPerWorker, tasks.length);
      if (start < tasks.length) {
        workerBatches.push(tasks.slice(start, end));
      }
    }

    let completedCount = 0;
    const totalCount = tasks.length;

    const workerPromises = workerBatches.map((batch, workerIndex) => {
      return new Promise<void>((resolve) => {
        const worker = this.workers[workerIndex];

        const reportedTaskIds = new Set<number>();
        let timer: ReturnType<typeof setTimeout>;
        const finish = (error: string, failed = false) => {
          cleanup();
          if (failed) {
            this.failedWorkers.set(worker, error);
            worker.terminate();
          }
          for (const task of batch) {
            if (reportedTaskIds.has(task.id)) continue;
            completedCount++;
            onResult?.({ id: task.id, rowIndex: task.rowIndex, filename: task.filename, error }, completedCount, totalCount);
          }
          resolve();
        };
        const restartTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(() => finish('Certificate rendering timed out', true), 90_000);
        };
        const cancel = () => {
          cleanup();
          resolve();
        };
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'itemComplete') {
            const result: BatchResultItem = event.data.result;
            if (reportedTaskIds.has(result.id)) return;
            reportedTaskIds.add(result.id);
            restartTimer();
            completedCount++;
            onResult?.(result, completedCount, totalCount);
          } else if (event.data.type === 'batchComplete') {
            finish('Worker finished without returning this certificate');
          }
        };
        const errorHandler = (event: ErrorEvent) => finish(event.message || 'Worker thread execution error', true);
        const messageErrorHandler = () => finish('Cannot read the worker output', true);
        const cleanup = () => {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          worker.removeEventListener('error', errorHandler);
          worker.removeEventListener('messageerror', messageErrorHandler);
        };

        const previousFailure = this.failedWorkers.get(worker);
        if (previousFailure) {
          finish(previousFailure);
          return;
        }
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
    });

    await Promise.all(workerPromises);
    this.pendingResolves = [];
  }

  terminate(): void {
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
