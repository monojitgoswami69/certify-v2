/**
 * Client-side Certificate Engine
 * 
 * Renders high-quality certificates on canvas with high-DPI awareness,
 * exports PDF and PNG files, and creates ZIP archives.
 */

import { jsPDF } from 'jspdf';
import type { TextBox, CsvRow, QrStyleConfig, ImageElement } from '../types';
import { getFontFamilyCSS } from './font-loader';
import { resolveFieldValue } from './utils';
import { drawStyledQr } from './qr-renderer';
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
  const cached = imageElementCache.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (imageElementCache.size > 100) imageElementCache.clear();
      imageElementCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
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
    frozenFields,
    filename,
    includeJpg,
    includePng,
    includePdf,
    includeBase64,
    qrZone,
    qrZones,
    images,
    verificationUrl,
    sampleQr,
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

  // Decorative elements (logos, signatures) sit above the background, below text.
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
