/**
 * Worker Pool for Parallel Certificate Generation (core - 1 Concurrency)
 *
 * Distributes certificate generation across (hardwareConcurrency - 1) Web Workers.
 * Workers remain warm across chunks, sharing the template Blob with zero-copy.
 */

import type { TextBox, CsvRow } from '../types';
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
  private pendingResolves: Array<() => void> = [];

  /**
   * Concurrency is configured to (cores - 1) to saturate available multi-core hardware
   * while keeping 1 core dedicated to the main thread for smooth 60 FPS UI interaction.
   */
  static getOptimalWorkerCount(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    // Clamp to 8 max workers to prevent tab memory exhaustion on mobile/tablets (e.g. iPad 1.5GB cap)
    // and high-core desktop workstations (e.g. 32-128 core workstations)
    return Math.max(1, Math.min(cores - 1, 8));
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
    maxWorkers?: number
  ): Promise<number> {
    const workerCount = maxWorkers ?? CertificateWorkerPool.getOptimalWorkerCount();
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
    if (tasks.length === 0 || this.workers.length === 0) return;

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

        this.pendingResolves.push(resolve);

        const handler = (event: MessageEvent) => {
          if (event.data.type === 'itemComplete') {
            const r: BatchResultItem = event.data.result;
            completedCount++;

            onResult?.(
              {
                id: r.id,
                rowIndex: r.rowIndex,
                filename: r.filename,
                verificationUrl: r.verificationUrl,
                blobs: r.blobs,
                error: r.error,
              },
              completedCount,
              totalCount
            );
          } else if (event.data.type === 'batchComplete') {
            cleanup();
            resolve();
          }
        };

        const errorHandler = (err: ErrorEvent) => {
          cleanup();
          console.error(`[WorkerPool] Worker ${workerIndex} encountered an unhandled error:`, err);
          for (const task of batch) {
            completedCount++;
            onResult?.(
              {
                id: task.id,
                rowIndex: task.rowIndex,
                filename: task.filename,
                error: err.message || 'Worker thread execution error',
              },
              completedCount,
              totalCount
            );
          }
          resolve();
        };

        const cleanup = () => {
          worker.removeEventListener('message', handler);
          worker.removeEventListener('error', errorHandler);
        };

        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);

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

  /**
   * Generates a single probe certificate to determine format-specific byte sizes.
   */
  async generateSingle(task: WorkerTask): Promise<BatchResultItem> {
    if (this.workers.length === 0) {
      throw new Error('Worker pool not initialized');
    }

    const worker = this.workers[0];

    return new Promise<BatchResultItem>((resolve) => {
      let result: BatchResultItem | null = null;

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'itemComplete') {
          const r = event.data.result;
          result = {
            id: r.id,
            rowIndex: r.rowIndex,
            filename: r.filename,
            verificationUrl: r.verificationUrl,
            blobs: r.blobs,
            error: r.error,
          };
        } else if (event.data.type === 'batchComplete') {
          worker.removeEventListener('message', handler);
          resolve(
            result ?? {
              id: task.id,
              rowIndex: task.rowIndex,
              filename: task.filename,
              error: 'Probe generation failed',
            }
          );
        }
      };

      worker.addEventListener('message', handler);

      const noop = () => {
        resolve({
          id: task.id,
          rowIndex: task.rowIndex,
          filename: task.filename,
          error: 'Worker pool terminated',
        });
      };
      this.pendingResolves.push(noop);

      worker.postMessage({
        type: 'generateBatch',
        items: [
          {
            id: task.id,
            rowIndex: task.rowIndex,
            row: task.row,
            filename: task.filename,
            verificationUrl: task.verificationUrl,
          },
        ],
      });
    });
  }

  getWorkerCount(): number {
    return this.workers.length;
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
  }
}
