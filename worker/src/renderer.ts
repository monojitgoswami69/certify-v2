import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas';
import { paintCertificate } from '../../src/lib/certificate-paint.js';
import type { IssuedEventDesign } from '../../src/lib/event-design.js';
import { computeExportScale } from '../../src/lib/export-scale.js';
import { MAX_MAIL_ATTACHMENT_BYTES } from '../../src/lib/mail-staging.js';
import { getFontFamilyCSS } from '../../src/lib/font-loader.js';
import {
  extractImageDimensions, hasImageMagicBytes, isWithinImagePixelBudget, parseImageDataUrl,
  MAX_BACKGROUND_TEMPLATE_PIXELS, MAX_TEMPLATE_BYTES,
} from '../../src/lib/image-validation.js';
import { PRESET_EMBLEMS } from '../../src/lib/qr-renderer.js';
import { createSignedR2ObjectUrl, extractR2TemplateKey, isR2Configured } from '../../src/lib/r2-storage.js';
import { sanitizeFilename } from '../../src/lib/utils.js';
import { buildVerifyUrlFor } from '../../src/lib/verification-links.js';
import type { EmailSettings, ImageElement, QrZone, TextBox } from '../../src/types/index.js';
import { ensureWorkerFontsLoaded } from './fonts.js';
import type { WorkerLogger } from './logger.js';
import { buildCertificatePdfFromCanvas } from './pdf-writer.js';

export class CertificateAttachmentSizeError extends Error {}

export interface RenderedMailAttachments {
  filename: string;
  pngBuffer?: Buffer;
  pdfBuffer?: Buffer;
}

function readRasterDimensions(bytes: Buffer) {
  const mime = (['png', 'jpeg', 'webp'] as const).find((type) => hasImageMagicBytes(bytes, type));
  const dimensions = mime && extractImageDimensions(bytes, mime);
  if (!dimensions || !isWithinImagePixelBudget(dimensions.width, dimensions.height)) {
    throw new Error('Invalid or oversized certificate artwork');
  }
  return dimensions;
}

async function fetchBoundedBytes(url: string, maxBytes: number, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch artwork (HTTP ${res.status})`);
  }
  const declared = Number(res.headers.get('content-length') || '0');
  if (!res.body || declared > maxBytes) {
    await res.body?.cancel();
    throw new Error('Template artwork is empty or exceeds its byte limit');
  }
  const reader = res.body.getReader();
  const target = Number.isSafeInteger(declared) && declared > 0 && !res.headers.has('content-encoding')
    ? Buffer.allocUnsafe(declared) : null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        if (target && size !== target.length) throw new Error('Template artwork download was incomplete');
        return target ?? Buffer.concat(chunks, size);
      }
      const offset = size;
      size += value.byteLength;
      if (size > (target?.length ?? maxBytes)) {
        await reader.cancel();
        throw new Error('Template artwork exceeds its expected size');
      }
      if (target) target.set(value, offset);
      else chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function loadArtworkBuffer(imageData: string, fetchImpl: typeof fetch): Promise<Buffer> {
  if (imageData.startsWith('data:')) {
    const parsed = parseImageDataUrl(imageData);
    if (!parsed || parsed.bytes.byteLength > MAX_TEMPLATE_BYTES) {
      throw new Error('Invalid inline template image data');
    }
    return Buffer.from(parsed.bytes);
  }
  if (imageData.startsWith('https://')) {
    const key = extractR2TemplateKey(imageData, 'full');
    if (!key) throw new Error('Template artwork does not match the configured R2 origin');
    const url = isR2Configured() ? createSignedR2ObjectUrl('GET', key) : imageData;
    return fetchBoundedBytes(url, MAX_TEMPLATE_BYTES, fetchImpl);
  }
  throw new Error('Unsupported template image reference');
}

/**
 * Single reusable render context per active batch so template artwork, decorative
 * logos, fonts, and the output canvas buffer are allocated only once per dyno.
 */
export class WorkerRenderContext {
  private templateImg: Image | null;
  private decorativeImages: Array<{ el: ImageElement; img: Image | null }>;
  private qrLogos: Map<string, Image | null>;
  private reusableCanvas: Canvas;
  private readonly boxes: TextBox[];
  private readonly qrZones: QrZone[];
  private readonly naturalW: number;
  private readonly naturalH: number;
  private readonly targetW: number;
  private readonly targetH: number;
  private readonly verificationOrigin: string | null | undefined;
  private disposed = false;

  private constructor(params: {
    templateImg: Image;
    decorativeImages: Array<{ el: ImageElement; img: Image | null }>;
    qrLogos: Map<string, Image | null>;
    design: IssuedEventDesign;
  }) {
    this.templateImg = params.templateImg;
    this.decorativeImages = params.decorativeImages;
    this.qrLogos = params.qrLogos;
    this.boxes = params.design.layoutConfig.boxes;
    this.qrZones = params.design.layoutConfig.qrZones ?? [];
    this.verificationOrigin = params.design.verificationOrigin;
    this.naturalW = params.templateImg.width || params.design.width;
    this.naturalH = params.templateImg.height || params.design.height;
    const exportScale = computeExportScale(this.naturalW, this.naturalH);
    this.targetW = Math.max(1, Math.floor(this.naturalW * exportScale));
    this.targetH = Math.max(1, Math.floor(this.naturalH * exportScale));
    this.reusableCanvas = createCanvas(this.targetW, this.targetH);
  }

  static async create(
    design: IssuedEventDesign,
    logger: WorkerLogger,
    fetchImpl: typeof fetch = fetch
  ): Promise<WorkerRenderContext> {
    let rawArtwork: Buffer | null = await loadArtworkBuffer(design.imageData, fetchImpl);
    const dimensions = readRasterDimensions(rawArtwork);
    if (dimensions.width * dimensions.height > MAX_BACKGROUND_TEMPLATE_PIXELS) {
      throw new Error('Certificate artwork exceeds the background rendering pixel budget');
    }
    const templateImg = await loadImage(rawArtwork);
    rawArtwork = null;

    const fontFamilies = new Set(design.layoutConfig.boxes.map((b) => b.fontFamily).filter(Boolean));
    if (design.layoutConfig.defaultFont) fontFamilies.add(design.layoutConfig.defaultFont);
    await ensureWorkerFontsLoaded(fontFamilies, logger, fetchImpl);

    let overlayPixels = 0;
    const decodeOverlay = async (src: string): Promise<Image | null> => {
      if (PRESET_EMBLEMS.some((preset) => preset.svgDataUri === src)) {
        return loadImage(Buffer.from(decodeURIComponent(src.slice(src.indexOf(',') + 1))));
      }
      const parsed = parseImageDataUrl(src);
      const dimensions = parsed?.dimensions;
      if (!parsed || !dimensions) return null;
      overlayPixels += dimensions.width * dimensions.height;
      if (overlayPixels > 8_000_000) throw new Error('Certificate overlays exceed the worker pixel budget');
      return loadImage(Buffer.from(parsed.bytes));
    };
    const decorativeImages = [];
    for (const el of design.layoutConfig.images ?? []) {
      decorativeImages.push({ el, img: await decodeOverlay(el.src) });
    }

    const qrLogos = new Map<string, Image | null>();
    for (const zone of design.layoutConfig.qrZones ?? []) {
      const logoSrc = zone.style?.logo;
      if (logoSrc && !qrLogos.has(logoSrc)) {
        qrLogos.set(logoSrc, await decodeOverlay(logoSrc));
      }
    }

    return new WorkerRenderContext({ templateImg, decorativeImages, qrLogos, design });
  }

  async render(params: {
    certificateId: string;
    recipientName: string;
    renderFields: Record<string, string>;
    formats: Pick<EmailSettings, 'attachPdf' | 'attachPng'>;
    fallbackOrigin?: string;
  }): Promise<RenderedMailAttachments> {
    if (this.disposed || !this.templateImg) {
      throw new Error('Render context has been disposed');
    }

    const ctx = this.reusableCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    paintCertificate(ctx, {
      artwork: this.templateImg as unknown as CanvasImageSource,
      width: this.naturalW,
      height: this.naturalH,
      targetWidth: this.targetW,
      targetHeight: this.targetH,
      images: this.decorativeImages.map(({ el, img }) => ({ el, image: img as unknown as CanvasImageSource | null })),
      qrZones: this.qrZones,
      getLogo: (src) => this.qrLogos.get(src) as unknown as CanvasImageSource | null,
      verificationUrl: buildVerifyUrlFor(params.certificateId, this.verificationOrigin ?? params.fallbackOrigin),
      text: this.boxes.filter((box) => box.kind === 'static' || box.field).map((box) => ({
        box,
        font: getFontFamilyCSS(box.fontFamily),
        value: box.kind === 'static' ? box.staticText ?? ''
          : Object.hasOwn(params.renderFields, box.field) ? params.renderFields[box.field] : '',
      })),
    });

    const filename = sanitizeFilename(params.recipientName);
    // Use the native encoder for the same PNG-size decision as Studio, even
    // for PDF-only output. Release the bytes before JPEG encoding in that case.
    let png = params.formats.attachPdf || params.formats.attachPng
      ? await this.reusableCanvas.encode('png') : undefined;
    const pngBytes = png?.byteLength ?? 0;
    if (params.formats.attachPng && pngBytes > MAX_MAIL_ATTACHMENT_BYTES) {
      throw new CertificateAttachmentSizeError('PNG attachment exceeds 24 MB. Try sending the PDF by itself.');
    }
    if (!params.formats.attachPng) png = undefined;


    const pdfBuffer = params.formats.attachPdf
      ? await buildCertificatePdfFromCanvas({
          canvas: this.reusableCanvas,
          targetWidth: this.targetW,
          targetHeight: this.targetH,
          naturalWidth: this.naturalW,
          naturalHeight: this.naturalH,
          pngBytes,
          maxBytes: MAX_MAIL_ATTACHMENT_BYTES - (png?.byteLength ?? 0),
        })
      : undefined;

    return {
      filename,
      pngBuffer: png,
      pdfBuffer,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.templateImg = null;
    this.decorativeImages = [];
    this.qrLogos.clear();
    this.reusableCanvas.width = 1;
    this.reusableCanvas.height = 1;
  }
}
