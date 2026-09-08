/**
 * Client-side Certificate Engine
 * 
 * Renders high-quality certificates on canvas with high-DPI awareness,
 * exports PDF and PNG files, and creates ZIP archives.
 */

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { TextBox, CsvRow, HorizontalAlign, VerticalAlign } from '../types';
import { getFontFamilyCSS } from './font-loader';
import { resolveFieldValue } from './utils';

export interface QrPlacement {
  x: number;
  y: number;
  size: number;
}

/**
 * Async wrapper around canvas.toBlob() so image encoding can run off the
 * main thread (browsers implement this off-thread), unlike the synchronous
 * canvas.toDataURL(). `quality` only applies to lossy formats (e.g. JPEG);
 * it is ignored for PNG (which is lossless).
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob() returned null'));
      },
      type,
      quality
    );
  });
}

export interface GeneratedCertificate {
  filename: string;
  jpgBlob?: Blob;
  pngBlob?: Blob;
  pdfBlob?: Blob;
  jpgBase64?: string;
  pngBase64?: string;
  pdfBase64?: string;
}

export interface GenerateParams {
  templateImage: HTMLImageElement;
  boxes: TextBox[];
  row: CsvRow;
  filename: string;
  includeJpg?: boolean;
  includePng?: boolean;
  includePdf?: boolean;
  includeBase64?: boolean;
  /** QR zone positions on the template (supports multiple QRs). */
  qrZones?: QrPlacement[];
  qrZone?: QrPlacement;
  /** Fully-qualified verification URL encoded into the QR (per record). */
  verificationUrl?: string;
  /**
   * Optional reusable canvas. When provided by a long-running caller (e.g. a
   * worker pool), allocation/GC churn is avoided across thousands of records.
   * The function resets its size and clears it before drawing.
   */
  canvas?: HTMLCanvasElement;
}

const engineFontSizeCache = new Map<string, number>();

/**
 * Binary search to find optimal font size fitting inside box dimensions (with LRU-bounded cache)
 */
function findOptimalFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  boxW: number,
  boxH: number,
  maxFontSize: number,
  fontFamily: string
): number {
  const cacheKey = `${text}:${boxW}:${boxH}:${maxFontSize}:${fontFamily}`;
  const cached = engineFontSizeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let min = 8;
  let max = maxFontSize;
  let optimal = min;
  const padding = 8;
  const maxW = boxW - padding;
  const maxH = boxH - padding;

  // Fast path: test if max font size fits immediately
  ctx.font = `${maxFontSize}px "${fontFamily}"`;
  if (ctx.measureText(text).width <= maxW && maxFontSize * 1.2 <= maxH) {
    if (engineFontSizeCache.size > 2000) engineFontSizeCache.clear();
    engineFontSizeCache.set(cacheKey, maxFontSize);
    return maxFontSize;
  }

  while (min <= max) {
    const mid = (min + max) >> 1;
    ctx.font = `${mid}px "${fontFamily}"`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = mid * 1.2;

    if (textWidth <= maxW && textHeight <= maxH) {
      optimal = mid;
      min = mid + 1;
    } else {
      max = mid - 1;
    }
  }

  if (engineFontSizeCache.size > 2000) engineFontSizeCache.clear();
  engineFontSizeCache.set(cacheKey, optimal);
  return optimal;
}

/**
 * Render a single text box onto a canvas 2D context
 */
export function drawTextBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TextBox
) {
  if (!text) return;

  const fontCSS = getFontFamilyCSS(box.fontFamily);
  const optimalFontSize = findOptimalFontSize(ctx, text, box.w, box.h, box.fontSize, fontCSS);

  ctx.save();
  ctx.font = `${optimalFontSize}px ${fontCSS}`;
  ctx.fillStyle = box.fontColor;

  let textX: number;
  if (box.hAlign === 'left') {
    ctx.textAlign = 'left';
    textX = box.x + 5;
  } else if (box.hAlign === 'right') {
    ctx.textAlign = 'right';
    textX = box.x + box.w - 5;
  } else {
    ctx.textAlign = 'center';
    textX = box.x + box.w / 2;
  }

  let textY: number;
  ctx.textBaseline = 'alphabetic';
  if (box.vAlign === 'top') {
    textY = box.y + optimalFontSize;
  } else if (box.vAlign === 'middle') {
    textY = box.y + (box.h + optimalFontSize) / 2 - 2;
  } else {
    textY = box.y + box.h - 8;
  }

  ctx.fillText(text, textX, textY);
  ctx.restore();
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Direct Bit-Matrix QR Code Rendering (Vector Accurate, Zero DOM, Sub-millisecond)
 */
function drawVerificationQr(
  ctx: CanvasRenderingContext2D,
  zone: QrPlacement,
  qr: QRCode.QRCode
): void {
  const moduleCount = qr.modules.size;
  const moduleSize = zone.size / moduleCount;

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.modules.get(r, c)) {
        ctx.rect(
          zone.x + c * moduleSize,
          zone.y + r * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Generate certificate as JPG / PNG / PDF blobs and (optionally) base64 strings.
 */
export async function generateCertificate(
  params: GenerateParams
): Promise<GeneratedCertificate> {
  const {
    templateImage,
    boxes,
    row,
    filename,
    includeJpg,
    includePng,
    includePdf,
    includeBase64,
    qrZone,
    qrZones,
    verificationUrl,
    canvas: provided,
  } = params;

  // Reuse a pooled canvas when provided; allocate otherwise.
  const canvas = provided ?? document.createElement('canvas');
  const naturalW = templateImage.naturalWidth || templateImage.width;
  const naturalH = templateImage.naturalHeight || templateImage.height;
  if (canvas.width !== naturalW) canvas.width = naturalW;
  if (canvas.height !== naturalH) canvas.height = naturalH;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(templateImage, 0, 0);

  const zonesToDraw = qrZones && qrZones.length > 0 ? qrZones : qrZone ? [qrZone] : [];
  if (zonesToDraw.length > 0 && verificationUrl) {
    const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: 'M' });
    for (const zone of zonesToDraw) {
      drawVerificationQr(ctx, zone, qr);
    }
  }

  for (const box of boxes) {
    if (!box.field) continue;
    const text = resolveFieldValue(box.field, row);
    drawTextBox(ctx, text, box);
  }

  const result: GeneratedCertificate = { filename };

  // Generate JPG if requested
  if (includeJpg) {
    const jpgBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    result.jpgBlob = jpgBlob;
    if (includeBase64) {
      result.jpgBase64 = await blobToBase64(jpgBlob);
    }
  }

  // Generate PNG if requested
  if (includePng) {
    const pngBlob = await canvasToBlob(canvas, 'image/png');
    result.pngBlob = pngBlob;
    if (includeBase64) {
      result.pngBase64 = await blobToBase64(pngBlob);
    }
  }

  // Generate PDF if requested
  if (includePdf) {
    const isLandscape = canvas.width > canvas.height;
    const pdf = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });

    // Use JPEG for lightweight & fast PDF rendering
    const pdfImgBlob = result.jpgBlob || (await canvasToBlob(canvas, 'image/jpeg', 0.92));
    const arrayBuffer = await pdfImgBlob.arrayBuffer();

    pdf.addImage(
      new Uint8Array(arrayBuffer),
      'JPEG',
      0,
      0,
      canvas.width,
      canvas.height,
      undefined,
      'FAST'
    );
    const pdfBlob = pdf.output('blob');
    result.pdfBlob = pdfBlob;

    if (includeBase64) {
      result.pdfBase64 = await blobToBase64(pdfBlob);
    }
  }

  return result;
}
