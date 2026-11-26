import type { EventLayout, IssuedEventDesign } from './event-design';
import {
  isWithinImagePixelBudget,
  MAX_INLINE_TEMPLATE_BYTES,
  MAX_TEMPLATE_DATA_URL_LENGTH,
  parseImageDataUrl,
} from './image-validation';
import { isAllowedR2TemplateUrl } from './r2-storage';

const MAX_LAYOUT_JSON_LENGTH = 1024 * 1024;
const MAX_LAYOUT_IMAGES = 30;
const MAX_DECORATIVE_IMAGE_LENGTH = 3 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_EDGE = 1400;
const MAX_PREVIEW_DATA_LENGTH = 2 * 1024 * 1024;

function matchesImageDimensions(
  parsed: { width: number; height: number } | null | undefined,
  width: number,
  height: number
): boolean {
  if (!parsed) return true;
  const exactMatch = parsed.width === width && parsed.height === height;
  const exifSwappedMatch = parsed.width === height && parsed.height === width;
  return exactMatch || exifSwappedMatch;
}

function isFiniteOptionalNumber(value: unknown, min = -Infinity, max = Infinity): boolean {
  if (value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Shared validator for `EventLayout` objects persisted by both `/api/templates`
 * and `/api/certificates/register`. Rejects invalid boxes, malformed QR configs,
 * oversized/unverified embedded images, and non-finite geometry.
 */
export function validateEventLayout(input: unknown): EventLayout | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const layout = input as Partial<EventLayout>;
  if (!Array.isArray(layout.boxes)) return null;
  if (
    layout.boxes.some(
      (box) =>
        !box ||
        typeof box !== 'object' ||
        (box.kind !== 'static' && typeof box.field !== 'string') ||
        !isFiniteOptionalNumber(box.x) ||
        !isFiniteOptionalNumber(box.y) ||
        !isFiniteOptionalNumber(box.w, 0) ||
        !isFiniteOptionalNumber(box.h, 0) ||
        !isFiniteOptionalNumber(box.fontSize, 0.1, 10_000)
    )
  ) {
    return null;
  }

  if (layout.qrZones !== undefined) {
    if (
      !Array.isArray(layout.qrZones) ||
      layout.qrZones.some(
        (zone) =>
          !zone ||
          typeof zone !== 'object' ||
          !isFiniteOptionalNumber(zone.x) ||
          !isFiniteOptionalNumber(zone.y) ||
          !isFiniteOptionalNumber(zone.size, 0.1)
      )
    ) {
      return null;
    }
  }

  if (layout.images !== undefined) {
    if (
      !Array.isArray(layout.images) ||
      layout.images.length > MAX_LAYOUT_IMAGES ||
      layout.images.some(
        (image) =>
          !image ||
          typeof image !== 'object' ||
          typeof image.src !== 'string' ||
          image.src.length > MAX_DECORATIVE_IMAGE_LENGTH ||
          !parseImageDataUrl(image.src) ||
          !isFiniteOptionalNumber(image.x) ||
          !isFiniteOptionalNumber(image.y) ||
          !isFiniteOptionalNumber(image.w, 0) ||
          !isFiniteOptionalNumber(image.h, 0) ||
          !isFiniteOptionalNumber(image.opacity, 0, 1)
      )
    ) {
      return null;
    }
  }

  if (JSON.stringify(layout).length > MAX_LAYOUT_JSON_LENGTH) return null;
  return layout as EventLayout;
}

export function readIssuedDesign(input: unknown): IssuedEventDesign | null {
  if (!input || typeof input !== 'object') return null;
  const {
    imageData,
    previewImageData,
    previewWidth,
    previewHeight,
    width,
    height,
    layoutConfig,
  } = input as Partial<IssuedEventDesign>;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !isWithinImagePixelBudget(width, height) ||
    typeof imageData !== 'string'
  ) {
    return null;
  }

  const imageIsR2 = isAllowedR2TemplateUrl(imageData, 'full');
  if (!imageIsR2) {
    if (imageData.length > MAX_TEMPLATE_DATA_URL_LENGTH) return null;
    const parsedImage = parseImageDataUrl(imageData);
    if (
      !parsedImage ||
      parsedImage.bytes.byteLength > MAX_INLINE_TEMPLATE_BYTES ||
      !matchesImageDimensions(parsedImage.dimensions, width, height)
    ) {
      return null;
    }
  }

  const validatedLayout = validateEventLayout(layoutConfig);
  if (!validatedLayout) return null;

  const hasAnyPreviewField =
    previewImageData !== undefined || previewWidth !== undefined || previewHeight !== undefined;
  if (!hasAnyPreviewField) {
    return { imageData, width, height, layoutConfig: validatedLayout };
  }

  if (
    typeof previewImageData !== 'string' ||
    typeof previewWidth !== 'number' ||
    typeof previewHeight !== 'number' ||
    !Number.isInteger(previewWidth) ||
    !Number.isInteger(previewHeight) ||
    previewWidth <= 0 ||
    previewHeight <= 0 ||
    Math.max(previewWidth, previewHeight) > MAX_PREVIEW_IMAGE_EDGE ||
    !isWithinImagePixelBudget(previewWidth, previewHeight) ||
    Math.abs(previewWidth * height - previewHeight * width) > Math.max(width, height)
  ) {
    return null;
  }

  const previewIsR2 = isAllowedR2TemplateUrl(previewImageData, 'preview');
  if (!previewIsR2) {
    if (previewImageData.length > MAX_PREVIEW_DATA_LENGTH) return null;
    const parsedPreview = parseImageDataUrl(previewImageData);
    if (!parsedPreview || !matchesImageDimensions(parsedPreview.dimensions, previewWidth, previewHeight)) {
      return null;
    }
  }

  return {
    imageData,
    previewImageData,
    previewWidth,
    previewHeight,
    width,
    height,
    layoutConfig: validatedLayout,
  };
}
