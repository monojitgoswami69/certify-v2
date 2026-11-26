/**
 * Pooled certificate renderer for flows that render on demand (email sending)
 * rather than batch-at-once (downloads).
 *
 * The worker pool renders whole chunks in parallel; this wrapper exposes a
 * sequential `render(task)` API backed by a chunk-ahead cache, so concurrent
 * send workers each get their blobs without the main thread ever running
 * jsPDF/canvas work. Rendering overlaps with network-bound sending.
 */
import { CertificateWorkerPool, type WorkerTask, type BatchResultItem } from './worker-pool';
import type { TextBox, CsvRow, ImageElement } from '../types';
import type { QrPlacement, OutputFormat } from './certificate-worker';
import type { WorkerFontData } from './font-loader';

export class PooledCertificateRenderer {
  private cache = new Map<number, BatchResultItem>();
  private nextIndex = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly pool: Pick<CertificateWorkerPool, 'processChunk'>,
    private readonly tasks: WorkerTask[],
    private readonly chunkSize: number
  ) {}

  async render(task: WorkerTask): Promise<BatchResultItem> {
    // Drive chunk-ahead rendering until this task's result exists. Concurrent
    // callers await the same in-flight chunk promise.
    while (!this.cache.has(task.rowIndex)) {
      if (!this.inflight) {
        if (this.nextIndex >= this.tasks.length) {
          return { id: task.id, rowIndex: task.rowIndex, filename: task.filename, error: 'Render task was not scheduled' };
        }
        const chunk = this.tasks.slice(this.nextIndex, this.nextIndex + this.chunkSize);
        this.nextIndex += chunk.length;
        this.inflight = this.pool
          .processChunk(chunk, (result) => {
            this.cache.set(result.rowIndex, result);
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : 'Worker pool execution failed';
            for (const item of chunk) {
              if (!this.cache.has(item.rowIndex)) {
                this.cache.set(item.rowIndex, {
                  id: item.id,
                  rowIndex: item.rowIndex,
                  filename: item.filename,
                  error: message,
                });
              }
            }
          })
          .finally(() => {
            this.inflight = null;
          });
      }
      await this.inflight;
    }

    const result = this.cache.get(task.rowIndex)!;
    this.cache.delete(task.rowIndex);
    return result;
  }
}

export interface PooledRendererParams {
  templateBlob: Blob;
  templateWidth: number;
  templateHeight: number;
  boxes: TextBox[];
  qrZones: QrPlacement[];
  images?: ImageElement[];
  formats: OutputFormat[];
  fonts?: WorkerFontData[];
  tasks: WorkerTask[];
}

/**
 * Creates a warm worker pool + renderer, or returns null when workers are
 * unsupported or initialization fails (caller falls back to the main thread).
 */
export async function createPooledRenderer(
  params: PooledRendererParams
): Promise<{ renderer: PooledCertificateRenderer; terminate: () => void } | null> {
  if (!CertificateWorkerPool.isSupported()) return null;
  const pool = new CertificateWorkerPool();
  try {
    const workerCount = await pool.initialize(
      params.templateBlob,
      params.templateWidth,
      params.templateHeight,
      params.boxes,
      params.qrZones,
      params.formats,
      params.fonts,
      params.tasks.length,
      params.images
    );
    return {
      renderer: new PooledCertificateRenderer(pool, params.tasks, Math.max(workerCount * 2, 8)),
      terminate: () => pool.terminate(),
    };
  } catch (err) {
    pool.terminate();
    console.warn('[RenderService] worker pool unavailable, using main thread:', err);
    return null;
  }
}

/** Converts an HTMLImageElement template to the Blob workers decode once. */
export async function templateImageToBlob(
  templateImage: HTMLImageElement,
  templateFile: Blob | null
): Promise<Blob | null> {
  if (templateFile) return templateFile;
  const canvas = document.createElement('canvas');
  canvas.width = templateImage.naturalWidth || templateImage.width;
  canvas.height = templateImage.naturalHeight || templateImage.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(templateImage, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
