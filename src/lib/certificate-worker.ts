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
import QRCode from 'qrcode';

export type OutputFormat = 'png' | 'jpg' | 'pdf';

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  field: string;
  fontSize: number;
  fontColor: string;
  fontFamily: string;
  hAlign: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
}

export interface QrPlacement {
  x: number;
  y: number;
  size: number;
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

export interface InitMessage {
  type: 'init';
  templateBlob: Blob;
  templateWidth: number;
  templateHeight: number;
  boxes: TextBox[];
  qrZones?: QrPlacement[];
  formats: OutputFormat[];
  jpegQuality?: number;
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
  textX: number;
  textAlign: CanvasTextAlign;
}

// =============================================================================
// Worker State
// =============================================================================

let cachedTemplateBitmap: ImageBitmap | null = null;
let cachedTemplateWidth = 0;
let cachedTemplateHeight = 0;
let cachedBoxRenderInfo: BoxRenderInfo[] = [];
let cachedQrZones: QrPlacement[] = [];
let cachedFormats: OutputFormat[] = [];
let cachedJpegQuality = 0.92;
let cachedPdfOrientation: 'landscape' | 'portrait' = 'landscape';

let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// =============================================================================
// Text Fitting & Rendering
// =============================================================================

const fontSizeCache = new Map<string, number>();

function findFittingFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  box: TextBox,
  fontBase: string
): number {
  const cacheKey = `${text.length}:${box.w}:${box.h}:${box.fontSize}:${box.fontFamily}`;
  const cached = fontSizeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const padding = 8;
  const maxW = box.w - padding;
  const maxH = box.h - padding;
  const minFontSize = 8;
  const maxFontSize = box.fontSize;

  ctx.font = `${maxFontSize}px ${fontBase}`;
  if (ctx.measureText(text).width <= maxW && maxFontSize * 1.2 <= maxH) {
    fontSizeCache.set(cacheKey, maxFontSize);
    return maxFontSize;
  }

  let low = minFontSize;
  let high = maxFontSize;
  let result = minFontSize;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    ctx.font = `${mid}px ${fontBase}`;

    if (ctx.measureText(text).width <= maxW && mid * 1.2 <= maxH) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  fontSizeCache.set(cacheKey, result);
  return result;
}

function drawTextBox(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  info: BoxRenderInfo
): void {
  if (!text || !text.trim()) return;

  const box = info.box;
  const fontSize = findFittingFontSize(ctx, text, box, info.fontBase);

  ctx.font = `${fontSize}px ${info.fontBase}`;
  ctx.fillStyle = box.fontColor;
  ctx.textAlign = info.textAlign;
  ctx.textBaseline = 'alphabetic';

  let textY: number;
  const vAlign = box.vAlign || 'bottom';
  if (vAlign === 'top') {
    textY = box.y + fontSize;
  } else if (vAlign === 'middle') {
    textY = box.y + (box.h + fontSize) / 2 - 2;
  } else {
    textY = box.y + box.h - 8;
  }

  ctx.fillText(text, info.textX, textY);
}

// =============================================================================
// Direct Bit-Matrix QR Code Rendering (Vector Accurate, Zero DOM)
// =============================================================================

function drawVerificationQr(
  ctx: OffscreenCanvasRenderingContext2D,
  zone: QrPlacement,
  url: string
): void {
  if (!url) return;

  // Generate the bit-matrix modules directly in memory
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const moduleCount = qr.modules.size;
  const moduleSize = zone.size / moduleCount;

  ctx.fillStyle = '#000000';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.modules.get(r, c)) {
        ctx.fillRect(
          zone.x + c * moduleSize,
          zone.y + r * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }
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
  if (!cachedTemplateBitmap || !reusableCanvas || !reusableCtx) {
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

  const ctx = reusableCtx;
  const canvas = reusableCanvas;

  if (fontSizeCache.size > 2000) {
    fontSizeCache.clear();
  }

  const needJpeg = cachedFormats.includes('jpg') || cachedFormats.includes('pdf');
  const needPng = cachedFormats.includes('png');

  let pending: PendingEncode | null = null;

  for (const item of items) {
    try {
      // 1. DRAW: Background Template
      ctx.drawImage(cachedTemplateBitmap, 0, 0);

      // 2. DRAW: QR Verification Zones
      if (item.verificationUrl && cachedQrZones.length > 0) {
        for (const zone of cachedQrZones) {
          drawVerificationQr(ctx, zone, item.verificationUrl);
        }
      }

      // 3. DRAW: Text Boxes
      for (const info of cachedBoxRenderInfo) {
        const text = item.row[info.box.field] || '';
        drawTextBox(ctx, text, info);
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
      cachedTemplateBitmap = await createImageBitmap(message.templateBlob);
      cachedTemplateWidth = message.templateWidth;
      cachedTemplateHeight = message.templateHeight;
      cachedFormats = message.formats;
      cachedJpegQuality = message.jpegQuality ?? 0.92;
      cachedPdfOrientation = message.templateWidth > message.templateHeight ? 'landscape' : 'portrait';
      cachedQrZones = message.qrZones || [];

      cachedBoxRenderInfo = message.boxes
        .filter((box) => box.field)
        .map((box) => {
          const hAlign = box.hAlign || 'center';
          let textX: number;
          let textAlign: CanvasTextAlign;

          if (hAlign === 'left') {
            textAlign = 'left';
            textX = box.x + 5;
          } else if (hAlign === 'right') {
            textAlign = 'right';
            textX = box.x + box.w - 5;
          } else {
            textAlign = 'center';
            textX = box.x + box.w / 2;
          }

          const fontBase = `"${box.fontFamily}", system-ui, -apple-system, sans-serif`;
          return { box, fontBase, textX, textAlign };
        });

      reusableCanvas = new OffscreenCanvas(cachedTemplateWidth, cachedTemplateHeight);
      reusableCtx = reusableCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
      })!;

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
