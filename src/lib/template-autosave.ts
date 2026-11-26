import type { TextBox, QrZone, ImageElement } from '../types';
import { apiFetch } from './api-client';

export interface AutoSaveTemplateParams {
  templateImage: HTMLImageElement | null;
  templateFile: File | null;
  eventName?: string;
  boxes: TextBox[];
  qrZones: QrZone[];
  images: ImageElement[];
  defaultFont?: string;
  defaultFontSize?: number;
  defaultFontColor?: string;
}

const ALLOWED_SAVE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PREVIEW_MAX_EDGE = 1400;
const PREVIEW_WEBP_QUALITY = 0.92;
const PREVIEW_MIN_SAVINGS_RATIO = 0.75;

interface EncodedImage {
  dataUrl: string;
  hash: string;
  width: number;
  height: number;
}

interface EncodedPreview {
  dataUrl: string;
  width: number;
  height: number;
}

// Re-encoding a full-resolution template costs hundreds of ms and megabytes;
// autosave runs on every register/generate/email pass with the same image, so
// cache the encoding keyed by the source object's identity.
const encodedImageCache = new WeakMap<object, Promise<EncodedImage>>();
const encodedPreviewCache = new WeakMap<object, Promise<EncodedPreview | null>>();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read template file'));
    reader.readAsDataURL(file);
  });
}

async function encodeTemplateImage(
  templateImage: HTMLImageElement,
  templateFile: File | null
): Promise<EncodedImage> {
  const width = templateImage.naturalWidth || templateImage.width;
  const height = templateImage.naturalHeight || templateImage.height;

  // Prefer the original uploaded bytes: identical pixels, no full-res canvas
  // re-encode, and JPEG sources stay JPEG instead of ballooning into PNG.
  if (templateFile && ALLOWED_SAVE_IMAGE_TYPES.includes(templateFile.type)) {
    try {
      const dataUrl = await fileToDataUrl(templateFile);
      return { dataUrl, hash: await sha256Hex(dataUrl), width, height };
    } catch {
      // Fall through to canvas encoding.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(templateImage, 0, 0);
  const dataUrl = canvas.toDataURL('image/png', 0.95);
  return { dataUrl, hash: await sha256Hex(dataUrl), width, height };
}

export function getCachedEncodedImage(
  templateImage: HTMLImageElement,
  templateFile: File | null
): Promise<EncodedImage> {
  const key = templateFile ?? templateImage;
  let encoded = encodedImageCache.get(key);
  if (!encoded) {
    encoded = encodeTemplateImage(templateImage, templateFile).catch((err) => {
      encodedImageCache.delete(key);
      throw err;
    });
    encodedImageCache.set(key, encoded);
  }
  return encoded;
}

async function encodePreviewWebp(
  templateImage: HTMLImageElement,
  width: number,
  height: number,
  fullDataUrlLength: number
): Promise<EncodedPreview | null> {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= 1 || width < 2 || height < 2) return null;

  const scale = Math.min(1, PREVIEW_MAX_EDGE / longestEdge);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(templateImage, 0, 0, targetWidth, targetHeight);

  try {
    const previewDataUrl = canvas.toDataURL('image/webp', PREVIEW_WEBP_QUALITY);
    // Older/minimal canvas backends can silently fall back to image/png.
    if (!previewDataUrl.startsWith('data:image/webp;base64,')) return null;
    // Strict size-reduction guard: skip preview storage if the raw upload is already compact.
    if (previewDataUrl.length >= fullDataUrlLength * PREVIEW_MIN_SAVINGS_RATIO) return null;
    return { dataUrl: previewDataUrl, width: targetWidth, height: targetHeight };
  } catch {
    return null;
  }
}

function getCachedEncodedPreview(
  templateImage: HTMLImageElement,
  templateFile: File | null,
  width: number,
  height: number,
  fullDataUrlLength: number
): Promise<EncodedPreview | null> {
  const key = templateFile ?? templateImage;
  let preview = encodedPreviewCache.get(key);
  if (!preview) {
    preview = encodePreviewWebp(templateImage, width, height, fullDataUrlLength).catch(() => {
      encodedPreviewCache.delete(key);
      return null;
    });
    encodedPreviewCache.set(key, preview);
  }
  return preview;
}

export async function prepareIssuedDesign(
  params: AutoSaveTemplateParams,
  options?: { includePreview?: boolean }
) {
  const { templateImage, templateFile, boxes, qrZones, images } = params;
  if (!templateImage) throw new Error('Upload a template before issuing certificates.');

  const { dataUrl, hash, width, height } = await getCachedEncodedImage(templateImage, templateFile);
  const preview = options?.includePreview
    ? await getCachedEncodedPreview(templateImage, templateFile, width, height, dataUrl.length)
    : null;
  return {
    imageData: dataUrl,
    imageHash: hash,
    ...(preview
      ? {
          previewImageData: preview.dataUrl,
          previewWidth: preview.width,
          previewHeight: preview.height,
        }
      : {}),
    width,
    height,
    layoutConfig: {
      boxes,
      qrZones,
      images,
      defaultFont: params.defaultFont || 'Inter',
      defaultFontSize: params.defaultFontSize || 28,
      defaultFontColor: params.defaultFontColor || '#000000',
    },
  };
}

/** Saves an editable template for future drafts. Issued designs live on events. */
export async function autoSaveCurrentTemplate(
  params: AutoSaveTemplateParams
): Promise<{ id?: string; name?: string } | null> {
  if (!params.templateImage) return null;

  const name = params.eventName?.trim()
    || (params.templateFile?.name ? params.templateFile.name.replace(/\.[^/.]+$/, '').trim() : 'Certificate Template');
  const design = await prepareIssuedDesign(params);
  const res = await apiFetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...design }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.template?.id) {
    throw new Error(result?.detail || 'Failed to save certificate template');
  }
  return result.template;
}
