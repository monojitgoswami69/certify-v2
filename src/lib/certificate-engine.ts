/**
 * Client-side Certificate Engine
 * 
 * Renders high-quality certificates on canvas with high-DPI awareness,
 * exports PDF and PNG files, and creates ZIP archives.
 */

import type { TextBox, CsvRow, ImageElement } from '../types';
import { getFontFamilyCSS } from './font-loader';
import { resolveFieldValue } from './utils';
import { ensureSvgDataUriDimensions } from './qr-renderer';
import { paintCertificate, type QrPlacement } from './certificate-paint';
import { computeExportScale, EXPORT_JPEG_QUALITY, PDF_MAX_PNG_BYTES } from './export-scale';

export type { QrPlacement } from './certificate-paint';

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

  const zones = qrZones?.length ? qrZones : qrZone ? [qrZone] : [];
  const imageLayers = [];
  for (const el of images ?? []) imageLayers.push({ el, image: await decodeImageElement(el.src) });
  const logos = new Map<string, HTMLImageElement | null>();
  if (verificationUrl || sampleQr) {
    for (const zone of zones) {
      const src = zone.style?.logo;
      if (src && !logos.has(src)) logos.set(src, await decodeImageElement(src));
    }
  }
  const text = boxes.filter((box) => box.kind === 'static' || box.field).map((box) => ({
    box,
    value: box.kind === 'static' ? box.staticText ?? ''
      : frozenFields ? (Object.hasOwn(row, box.field) ? row[box.field] : '') : resolveFieldValue(box.field, row),
    font: getFontFamilyCSS(box.fontFamily),
  }));
  paintCertificate(ctx, {
    artwork: templateImage, width: logicalW, height: logicalH, targetWidth: canvasW, targetHeight: canvasH, images: imageLayers,
    qrZones: zones, getLogo: (src) => logos.get(src), verificationUrl, sampleQr, text,
  });

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

  const naturalW = params.templateImage.naturalWidth || params.templateImage.width;
  const naturalH = params.templateImage.naturalHeight || params.templateImage.height;
  const exportScale = computeExportScale(naturalW, naturalH);
  const canvas = await drawCertificateToCanvas({
    ...params,
    logicalWidth: naturalW,
    logicalHeight: naturalH,
    targetWidth: Math.max(1, Math.floor(naturalW * exportScale)),
    targetHeight: Math.max(1, Math.floor(naturalH * exportScale)),
  });

  const result: GeneratedCertificate = { filename };

  // Generate JPG if requested (high quality preserves thin QR edges)
  if (includeJpg) {
    const jpgBlob = await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY);
    result.jpgBlob = jpgBlob;
    if (includeBase64) {
      result.jpgBase64 = await blobToBase64(jpgBlob);
    }
  }

  // Generate PNG if requested or needed for lossless PDF embedding
  let pdfPngBlob: Blob | undefined;
  if (includePng || includePdf) {
    const pngBlob = await canvasToBlob(canvas, 'image/png');
    pdfPngBlob = pngBlob;
    if (includePng) {
      result.pngBlob = pngBlob;
      if (includeBase64) {
        result.pngBase64 = await blobToBase64(pngBlob);
      }
    }
  }

  // Generate PDF only when explicitly requested (lazy-loads jsPDF)
  if (includePdf) {
    const { jsPDF } = await import('jspdf');
    const isLandscape = naturalW > naturalH;
    const pdf = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'px',
      format: [naturalW, naturalH],
    });

    // Prefer lossless PNG inside PDFs so small QR modules and typography stay
    // razor sharp; fall back to high-quality JPEG only for >6 MB photo backgrounds.
    const usePng = Boolean(pdfPngBlob && pdfPngBlob.size <= PDF_MAX_PNG_BYTES);
    const pdfImgBlob = usePng
      ? pdfPngBlob!
      : result.jpgBlob || (await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY));
    const arrayBuffer = await pdfImgBlob.arrayBuffer();

    pdf.addImage(
      new Uint8Array(arrayBuffer),
      usePng ? 'PNG' : 'JPEG',
      0,
      0,
      naturalW,
      naturalH,
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
