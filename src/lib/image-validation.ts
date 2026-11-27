/**
 * Image signature and dimension validation for uploaded templates and elements.
 *
 * Checking only the data-URL header or compressed byte length is not enough:
 * a small compressed file can expand into a multi-gigabyte pixel buffer.
 * Parsing image headers lets both uploads and API routes enforce an exact
 * pixel budget before decoding.
 */

export type SupportedImageType = 'png' | 'jpeg' | 'webp';

/** Bounded pixel budget: covers 8K+ print templates while preventing OOM bombs. */
export const MAX_IMAGE_EDGE = 12_000;
export const MAX_IMAGE_PIXELS = 48_000_000;
/** Background rendering budget for the Basic worker's 512 MB process. */
export const MAX_BACKGROUND_TEMPLATE_PIXELS = 16_000_000;
/** Strict 15 MB template upload limit (delivered directly via Cloudflare R2). */
export const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;
/** Inline base64 ceiling when object storage isn't configured (fits under Vercel 4.5 MB limit). */
export const MAX_INLINE_TEMPLATE_BYTES = 3 * 1024 * 1024;
export const MAX_TEMPLATE_DATA_URL_LENGTH = Math.ceil((MAX_INLINE_TEMPLATE_BYTES * 4) / 3) + 128;

const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;

export function isWithinImagePixelBudget(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_EDGE &&
    height <= MAX_IMAGE_EDGE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

/**
 * Extracts `{ width, height }` from PNG, JPEG, or WebP headers without allocating
 * a decoded bitmap. Returns `null` when dimensions cannot be read cleanly.
 */
export function extractImageDimensions(
  bytes: Uint8Array,
  mime: SupportedImageType
): { width: number; height: number } | null {
  if (mime === 'png') {
    // IHDR chunk starts at byte 8 (len=4, type='IHDR'=4, width=4BE, height=4BE).
    if (
      bytes.length < 24 ||
      bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
    ) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (mime === 'webp') {
    if (bytes.length < 16 || bytes[12] !== 0x56 || bytes[13] !== 0x50 || bytes[14] !== 0x38) {
      return null;
    }
    const variant = bytes[15];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // VP8X (extended): flags/reserved (4 bytes) then 24-bit (width-1), 24-bit (height-1).
    if (variant === 0x58 && bytes.length >= 30) {
      const wMinus1 = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
      const hMinus1 = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
      return { width: wMinus1 + 1, height: hMinus1 + 1 };
    }
    // VP8L (lossless): signature 0x2f at byte 20, followed by 14-bit w-1 & 14-bit h-1.
    if (variant === 0x4c && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    // VP8 (lossy): keyframe sync code 0x9d 0x01 0x2a at bytes 23..25.
    if (variant === 0x20 && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    return null;
  }

  // JPEG: walk marker segments until a SOF frame containing image dimensions.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    // Standalone markers (TEM, RST0..7, SOI, EOI) carry no length word.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    // Start of Scan reaches entropy-coded data; SOF always precedes it.
    if (marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (segmentLength < 7) return null;
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function parseImageDataUrl(
  value: unknown
): { mime: SupportedImageType; bytes: Uint8Array; dimensions: { width: number; height: number } | null } | null {
  if (typeof value !== 'string') return null;
  const match = IMAGE_DATA_URL_RE.exec(value);
  if (!match) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;

  const mime: SupportedImageType = match[1] === 'jpg' ? 'jpeg' : (match[1] as SupportedImageType);
  const bytes = new Uint8Array(buffer);
  if (!hasImageMagicBytes(bytes, mime)) return null;

  const dimensions = extractImageDimensions(bytes, mime);
  if (dimensions && !isWithinImagePixelBudget(dimensions.width, dimensions.height)) {
    return null;
  }

  return { mime, bytes, dimensions };
}

export function hasImageMagicBytes(bytes: Uint8Array, mime: SupportedImageType): boolean {
  if (mime === 'png') {
    // 89 50 4E 47 0D 0A 1A 0A
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    );
  }
  if (mime === 'jpeg') {
    // FF D8 FF
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  // WebP: "RIFF" <len:4> "WEBP"
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  );
}
