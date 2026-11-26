/**
 * Web Worker for Parallel Certificate Generation
 *
 * Runs off the main browser thread on an OffscreenCanvas.
 * - Single-pass multi-format rendering (one draw emits PNG, JPG, and PDF)
 * - Template decoded once into GPU texture via createImageBitmap(blob)
 * - Direct bit-matrix QR code rendering (sub-millisecond, zero DOM, zero Base64)
 * - Pipelined dual-buffer encoding (encodes record N while drawing record N+1)
 * - In-worker parallel PDF construction via jsPDF
 */

import { jsPDF } from 'jspdf';
import type { QrStyleConfig, ImageElement, TextBox } from '../types';
import { resolveFieldValue } from './utils';
import { drawStyledQr, ensureSvgDataUriDimensions } from './qr-renderer';
import { getFontFamilyCSS } from './font-loader';
import { clearTextMeasurements, drawCertificateText } from './certificate-text';

export type OutputFormat = 'png' | 'jpg' | 'pdf';


export interface QrPlacement {
  x: number;
  y: number;
  size: number;
  style?: QrStyleConfig;
}

export interface CsvRow {
  [key: string]: string;
}

export interface BatchItem {
  id: number;
  rowIndex: number;
  row: CsvRow;
  filename: string;
  verificationUrl?: string;
}

export interface WorkerFontData {
  family: string;
  buffer: ArrayBuffer;
  weight?: string;
  style?: string;
}

export interface InitMessage {
  type: 'init';
  templateBlob: Blob;
  templateWidth: number;
  templateHeight: number;
  boxes: TextBox[];
  qrZones?: QrPlacement[];
  images?: ImageElement[];
  formats: OutputFormat[];
  jpegQuality?: number;
  fonts?: WorkerFontData[];
}

export interface GenerateBatchMessage {
  type: 'generateBatch';
  items: BatchItem[];
}

export interface BatchResultItem {
  id: number;
  rowIndex: number;
  filename: string;
  verificationUrl?: string;
  blobs?: Partial<Record<OutputFormat, Blob>>;
  error?: string;
}

export interface WorkerResponse {
  type: 'ready' | 'batchComplete' | 'itemComplete';
  result?: BatchResultItem;
}

interface BoxRenderInfo {
  box: TextBox;
  fontBase: string;
}

// =============================================================================
// Worker State
// =============================================================================

let cachedTemplateBitmap: ImageBitmap | null = null;
let cachedTemplateWidth = 0;
let cachedTemplateHeight = 0;
let cachedBoxRenderInfo: BoxRenderInfo[] = [];
let cachedQrZones: QrPlacement[] = [];
let cachedImageElements: Array<{ el: ImageElement; bitmap: ImageBitmap | null }> = [];
let cachedLogoBitmaps = new Map<string, ImageBitmap>();
let cachedFormats: OutputFormat[] = [];
let cachedJpegQuality = 0.92;
let cachedPdfOrientation: 'landscape' | 'portrait' = 'landscape';

let reusableCanvases: OffscreenCanvas[] | null = null;
let reusableContexts: OffscreenCanvasRenderingContext2D[] | null = null;

// =============================================================================
// Direct Bit-Matrix QR Code Rendering (Vector Accurate, Zero DOM)
// =============================================================================

function drawVerificationQr(
  ctx: OffscreenCanvasRenderingContext2D,
  zone: QrPlacement,
  verificationUrl: string
): void {
  const logoBitmap = zone.style?.logo ? cachedLogoBitmaps.get(zone.style.logo) : null;
  drawStyledQr(ctx, {
    x: zone.x,
    y: zone.y,
    size: zone.size,
    text: verificationUrl,
    style: zone.style,
    logoImg: logoBitmap,
  });
}

// =============================================================================
// Parallel In-Worker PDF Assembly
// =============================================================================

async function buildPdfFromJpeg(jpegBlob: Blob): Promise<Blob> {
  const arrayBuffer = await jpegBlob.arrayBuffer();
  const pdf = new jsPDF({
    orientation: cachedPdfOrientation,
    unit: 'px',
    format: [cachedTemplateWidth, cachedTemplateHeight],
  });

  pdf.addImage(
    new Uint8Array(arrayBuffer),
    'JPEG',
    0,
    0,
    cachedTemplateWidth,
    cachedTemplateHeight,
    undefined,
    'FAST'
  );

  return pdf.output('blob');
}

// =============================================================================
// Pipelined Dual-Buffer Encoding
// =============================================================================

interface PendingEncode {
  item: BatchItem;
  jpegPromise: Promise<Blob> | null;
  pngPromise: Promise<Blob> | null;
}

async function flushPending(pending: PendingEncode): Promise<void> {
  const { item, jpegPromise, pngPromise } = pending;
  try {
    const blobs: Partial<Record<OutputFormat, Blob>> = {};

    const [pngBlob, jpegBlob] = await Promise.all([
      pngPromise,
      jpegPromise,
    ]);

    if (pngBlob && cachedFormats.includes('png')) {
      blobs.png = pngBlob;
    }
    if (jpegBlob && cachedFormats.includes('jpg')) {
      blobs.jpg = jpegBlob;
    }
    if (jpegBlob && cachedFormats.includes('pdf')) {
      blobs.pdf = await buildPdfFromJpeg(jpegBlob);
    }

    self.postMessage({
      type: 'itemComplete',
      result: {
        id: item.id,
        rowIndex: item.rowIndex,
        filename: item.filename,
        verificationUrl: item.verificationUrl,
        blobs,
      },
    } as WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: 'itemComplete',
      result: {
        id: item.id,
        rowIndex: item.rowIndex,
        filename: item.filename,
        verificationUrl: item.verificationUrl,
        error: error instanceof Error ? error.message : 'Encoding failed',
      },
    } as WorkerResponse);
  }
}

// =============================================================================
// Batch Generator Core Loop
// =============================================================================

async function generateBatch(items: BatchItem[]): Promise<void> {
  if (!cachedTemplateBitmap || !reusableCanvases || !reusableContexts) {
    for (const item of items) {
      self.postMessage({
        type: 'itemComplete',
        result: {
          id: item.id,
          rowIndex: item.rowIndex,
          filename: item.filename,
          verificationUrl: item.verificationUrl,
          error: 'Worker not initialized',
        },
      } as WorkerResponse);
    }
    return;
  }

  const needJpeg = cachedFormats.includes('jpg') || cachedFormats.includes('pdf');
  const needPng = cachedFormats.includes('png');

  let activeBufferIdx = 0;
  let pending: PendingEncode | null = null;

  for (const item of items) {
    try {
      if (pending && reusableCanvases.length === 1) {
        await flushPending(pending);
        pending = null;
      }
      const canvas = reusableCanvases[activeBufferIdx];
      const ctx = reusableContexts[activeBufferIdx];
      activeBufferIdx = (activeBufferIdx + 1) % reusableCanvases.length;

      // 1. DRAW: Background Template
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cachedTemplateBitmap, 0, 0);

      // 1b. DRAW: Decorative image elements (logos, signatures)
      for (const { el, bitmap } of cachedImageElements) {
        if (!bitmap) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity ?? 1));
        ctx.drawImage(bitmap, el.x, el.y, el.w, el.h);
        ctx.restore();
      }

      // 2. DRAW: QR Verification Zones
      if (item.verificationUrl && cachedQrZones.length > 0) {
        for (const zone of cachedQrZones) {
          drawVerificationQr(ctx, zone, item.verificationUrl);
        }
      }

      // 3. DRAW: Text Boxes
      for (const info of cachedBoxRenderInfo) {
        const text =
          info.box.kind === 'static'
            ? info.box.staticText ?? ''
            : resolveFieldValue(info.box.field, item.row);
        drawCertificateText(ctx, text, info.box, info.fontBase);
      }

      // 4. ENCODE: Non-blocking OffscreenCanvas toBlob
      const jpegPromise = needJpeg
        ? canvas.convertToBlob({ type: 'image/jpeg', quality: cachedJpegQuality })
        : null;
      const pngPromise = needPng
        ? canvas.convertToBlob({ type: 'image/png' })
        : null;

      // 5. FLUSH PREVIOUS RECORD while current is encoding
      if (pending) {
        await flushPending(pending);
      }

      pending = { item, jpegPromise, pngPromise };
    } catch (error) {
      if (pending) {
        await flushPending(pending);
        pending = null;
      }

      self.postMessage({
        type: 'itemComplete',
        result: {
          id: item.id,
          rowIndex: item.rowIndex,
          filename: item.filename,
          verificationUrl: item.verificationUrl,
          error: error instanceof Error ? error.message : 'Render failed',
        },
      } as WorkerResponse);
    }
  }

  if (pending) {
    await flushPending(pending);
  }
}

// =============================================================================
// Message Listener
// =============================================================================

self.onmessage = async (event: MessageEvent<InitMessage | GenerateBatchMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      // 1. Load custom web fonts into worker's FontFaceSet
      if (message.fonts && message.fonts.length > 0 && typeof FontFace !== 'undefined') {
        const fontSet = (self as unknown as { fonts?: FontFaceSet }).fonts;
        if (fontSet) {
          for (const fontData of message.fonts) {
            try {
              const fontFace = new FontFace(fontData.family, fontData.buffer, {
                weight: fontData.weight || '400',
                style: fontData.style || 'normal',
              });
              // Explicitly load the individual font with a 3s timeout guard.
              // CRITICAL: NEVER await `fontSet.ready` in Web Workers — in Chromium and WebKit,
              // `fontSet.ready` tracks document layout tasks which do not exist in WorkerGlobalScope,
              // causing `await fontSet.ready` to hang indefinitely!
              const loadedFace = await Promise.race([
                fontFace.load(),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Font decode timeout')), 3000)
                ),
              ]);
              fontSet.add(loadedFace);
            } catch (fontErr) {
              console.warn(`[Worker] Failed to load font ${fontData.family}:`, fontErr);
            }
          }
        }
      }

      // Release any previously held GPU bitmaps & cached text metrics on re-init.
      cachedTemplateBitmap?.close();
      cachedTemplateBitmap = null;
      for (const item of cachedImageElements) {
        item.bitmap?.close();
      }
      cachedImageElements = [];
      for (const bitmap of cachedLogoBitmaps.values()) {
        bitmap.close();
      }
      cachedLogoBitmaps.clear();
      if (reusableContexts) {
        for (const cx of reusableContexts) {
          clearTextMeasurements(cx);
        }
      }
      reusableCanvases = null;
      reusableContexts = null;

      cachedTemplateBitmap = await Promise.race([
        createImageBitmap(message.templateBlob),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Template decode timeout')), 15000)
        ),
      ]);
      cachedTemplateWidth = message.templateWidth;
      cachedTemplateHeight = message.templateHeight;
      cachedFormats = message.formats;
      cachedJpegQuality = message.jpegQuality ?? 0.92;
      cachedPdfOrientation = message.templateWidth > message.templateHeight ? 'landscape' : 'portrait';
      cachedQrZones = message.qrZones || [];

      // Decode decorative image elements (logos, signatures) once per init.
      for (const el of message.images ?? []) {
        try {
          const res = await fetch(ensureSvgDataUriDimensions(el.src), {
            signal: AbortSignal.timeout(10_000),
          });
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          cachedImageElements.push({ el, bitmap });
        } catch {
          cachedImageElements.push({ el, bitmap: null });
        }
      }

      for (const zone of cachedQrZones) {
        if (zone.style?.logo && !cachedLogoBitmaps.has(zone.style.logo)) {
          try {
            const res = await fetch(ensureSvgDataUriDimensions(zone.style.logo), {
              signal: AbortSignal.timeout(10_000),
            });
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);
            cachedLogoBitmaps.set(zone.style.logo, bitmap);
          } catch {
            // Silently fallback if logo fails to decode
          }
        }
      }

      cachedBoxRenderInfo = message.boxes
        .filter((box) => box.field || box.kind === 'static')
        .map((box) => ({ box, fontBase: getFontFamilyCSS(box.fontFamily) }));

      const createBuffer = () => {
        const c = new OffscreenCanvas(cachedTemplateWidth, cachedTemplateHeight);
        let cx = c.getContext('2d', {
          desynchronized: true,
        });
        // Fall back when the browser cannot honor the requested context attributes.
        if (!cx) {
          cx = c.getContext('2d');
        }
        if (!cx) {
          throw new Error('Failed to acquire 2D context from OffscreenCanvas in Worker');
        }
        return { c, cx };
      };

      const bufferCount = cachedTemplateWidth * cachedTemplateHeight >= 8_000_000 ? 1 : 2;
      const buffers = Array.from({ length: bufferCount }, createBuffer);
      reusableCanvases = buffers.map(({ c }) => c);
      reusableContexts = buffers.map(({ cx }) => cx);

      self.postMessage({ type: 'ready' } as WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: 'ready',
        result: {
          id: -1,
          rowIndex: -1,
          filename: '',
          error: err instanceof Error ? err.message : 'Worker initialization failed',
        },
      } as WorkerResponse);
    }
  } else if (message.type === 'generateBatch') {
    await generateBatch(message.items);
    self.postMessage({ type: 'batchComplete' } as WorkerResponse);
  }
};

export {};
