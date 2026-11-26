/**
 * Client-side Certificate Engine
 * 
 * Renders high-quality certificates on canvas with high-DPI awareness,
 * exports PDF and PNG files, and creates ZIP archives.
 */

import type { TextBox, CsvRow, QrStyleConfig, ImageElement } from '../types';
import { getFontFamilyCSS } from './font-loader';
import { resolveFieldValue } from './utils';
import { drawStyledQr, ensureSvgDataUriDimensions } from './qr-renderer';
import { drawCertificateText } from './certificate-text';

import { SAMPLE_QR_URL } from './verification-links';

export interface QrPlacement {
  x: number;
  y: number;
  size: number;
  style?: QrStyleConfig;
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
  /** Decorative bitmap elements (logos, signatures) drawn above the background. */
  images?: ImageElement[];
  /** Fully-qualified verification URL encoded into the QR (per record). */
  verificationUrl?: string;
  sampleQr?: boolean;
  /**
   * Optional reusable canvas. When provided by a long-running caller (e.g. a
   * worker pool), allocation/GC churn is avoided across thousands of records.
   * The function resets its size and clears it before drawing.
   */
  canvas?: HTMLCanvasElement;
  /** Use values already resolved at issuance. */
  frozenFields?: boolean;
}

function drawTextBox(ctx: CanvasRenderingContext2D, text: string, box: TextBox) {
  drawCertificateText(ctx, text, box, getFontFamilyCSS(box.fontFamily));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Decoded image elements, cached by src so repeated renders (batches,
// previews) do not re-decode the same logo/signature.
const imageElementCache = new Map<string, HTMLImageElement>();

function decodeImageElement(src: string): Promise<HTMLImageElement | null> {
  const normalizedSrc = ensureSvgDataUriDimensions(src);
  const cached = imageElementCache.get(normalizedSrc);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (imageElementCache.size > 100) imageElementCache.clear();
      imageElementCache.set(normalizedSrc, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = normalizedSrc;
  });
}

export type DrawCertificateParams = Pick<
  GenerateParams,
  'templateImage' | 'boxes' | 'row' | 'frozenFields' | 'qrZone' | 'qrZones' | 'images' | 'verificationUrl' | 'sampleQr' | 'canvas'
> & {
  /** Logical coordinate dimensions when `templateImage` is a downscaled preview. */
  logicalWidth?: number;
  logicalHeight?: number;
  /** Optional canvas pixel dimensions (defaults to `templateImage` natural size). */
  targetWidth?: number;
  targetHeight?: number;
};

/**
 * Draws a certificate (artwork, decorative images, styled QR zones, and auto-fitted
 * text) onto a canvas without encoding blobs or loading jsPDF. When logical and
 * target dimensions differ (e.g., downscaled preview asset), scales cleanly from
 * logical template coordinates without allocating a full-resolution bitmap.
 */
export async function drawCertificateToCanvas(
  params: DrawCertificateParams
): Promise<HTMLCanvasElement> {
  const {
    templateImage,
    boxes,
    row,
    frozenFields,
    qrZone,
    qrZones,
    images,
    verificationUrl,
    sampleQr,
    canvas: provided,
    logicalWidth,
    logicalHeight,
    targetWidth,
    targetHeight,
  } = params;

  const canvas = provided ?? document.createElement('canvas');
  const naturalW = templateImage.naturalWidth || templateImage.width;
  const naturalH = templateImage.naturalHeight || templateImage.height;
  const logicalW = logicalWidth && logicalWidth > 0 ? logicalWidth : naturalW;
  const logicalH = logicalHeight && logicalHeight > 0 ? logicalHeight : naturalH;
  const canvasW = Math.max(1, Math.round(targetWidth && targetWidth > 0 ? targetWidth : naturalW));
  const canvasH = Math.max(1, Math.round(targetHeight && targetHeight > 0 ? targetHeight : naturalH));
  if (canvas.width !== canvasW) canvas.width = canvasW;
  if (canvas.height !== canvasH) canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scaleX = canvasW / Math.max(1, logicalW);
  const scaleY = canvasH / Math.max(1, logicalH);
  const needsScale = Math.abs(scaleX - 1) > 1e-6 || Math.abs(scaleY - 1) > 1e-6;

  ctx.save();
  try {
    if (needsScale) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(scaleX, scaleY);
    }
    ctx.drawImage(templateImage, 0, 0, logicalW, logicalH);

    if (images && images.length > 0) {
      for (const el of images) {
        const decoded = await decodeImageElement(el.src);
        if (!decoded) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity ?? 1));
        ctx.drawImage(decoded, el.x, el.y, el.w, el.h);
        ctx.restore();
      }
    }

    const zonesToDraw = qrZones && qrZones.length > 0 ? qrZones : qrZone ? [qrZone] : [];
    const qrText = sampleQr ? SAMPLE_QR_URL : verificationUrl;
    if (zonesToDraw.length > 0 && qrText) {
      for (const zone of zonesToDraw) {
        const logo = zone.style?.logo ? await decodeImageElement(zone.style.logo) : null;
        drawStyledQr(ctx, {
          x: zone.x,
          y: zone.y,
          size: zone.size,
          text: qrText,
          style: zone.style,
          logoImg: logo,
        });
        if (sampleQr) {
          ctx.save();
          const bannerHeight = zone.size * 0.21;
          ctx.fillStyle = '#171717';
          ctx.fillRect(zone.x, zone.y + zone.size - bannerHeight, zone.size, bannerHeight);
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${bannerHeight * 0.72}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SAMPLE', zone.x + zone.size / 2, zone.y + zone.size - bannerHeight / 2, zone.size * 0.9);
          ctx.restore();
        }
      }
    }

    for (const box of boxes) {
      if (box.kind === 'static') {
        drawTextBox(ctx, box.staticText ?? '', box);
        continue;
      }
      if (!box.field) continue;
      const text = frozenFields ? (Object.hasOwn(row, box.field) ? row[box.field] : '') : resolveFieldValue(box.field, row);
      drawTextBox(ctx, text, box);
    }
  } finally {
    ctx.restore();
  }

  return canvas;
}

/**
 * Renders a fast downscaled WebP (fallback PNG) preview blob in a single encode pass,
 * capping the longest edge at `maxEdge` (default 1400px) so portrait and landscape
 * templates never allocate oversized backing buffers on interactive verify views.
 */
export async function renderCertificatePreviewBlob(
  params: DrawCertificateParams,
  maxEdge = 1400
): Promise<{ blob: Blob; width: number; height: number }> {
  const naturalW = params.templateImage.naturalWidth || params.templateImage.width;
  const naturalH = params.templateImage.naturalHeight || params.templateImage.height;
  const logicalW = params.logicalWidth && params.logicalWidth > 0 ? params.logicalWidth : naturalW;
  const logicalH = params.logicalHeight && params.logicalHeight > 0 ? params.logicalHeight : naturalH;
  const scale = Math.min(1, maxEdge / Math.max(1, logicalW, logicalH));
  const width = Math.max(1, Math.round(logicalW * scale));
  const height = Math.max(1, Math.round(logicalH * scale));

  const targetCanvas = await drawCertificateToCanvas({
    ...params,
    logicalWidth: logicalW,
    logicalHeight: logicalH,
    targetWidth: width,
    targetHeight: height,
  });

  const blob = await canvasToBlob(targetCanvas, 'image/webp', 0.92).catch(() =>
    canvasToBlob(targetCanvas, 'image/png')
  );
  return { blob, width: targetCanvas.width, height: targetCanvas.height };
}

/**
 * Generate certificate as JPG / PNG / PDF blobs and (optionally) base64 strings.
 */
export async function generateCertificate(
  params: GenerateParams
): Promise<GeneratedCertificate> {
  const {
    filename,
    includeJpg,
    includePng,
    includePdf,
    includeBase64,
  } = params;

  const canvas = await drawCertificateToCanvas(params);

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

  // Generate PDF only when explicitly requested (lazy-loads jsPDF)
  if (includePdf) {
    const { jsPDF } = await import('jspdf');
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
