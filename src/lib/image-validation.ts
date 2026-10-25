/**
 * Server-side image content validation for stored template graphics.
 *
 * The data-URL prefix regex only proves the string *claims* to be an image.
 * These helpers additionally check the decoded magic bytes, so a mislabeled
 * or malicious payload never lands in the templates table.
 */

export type SupportedImageType = 'png' | 'jpeg' | 'webp';

const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;

export function parseImageDataUrl(
  value: unknown
): { mime: SupportedImageType; bytes: Uint8Array } | null {
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
  if (!hasImageMagicBytes(buffer, mime)) return null;

  return { mime, bytes: new Uint8Array(buffer) };
}

function hasImageMagicBytes(bytes: Uint8Array, mime: SupportedImageType): boolean {
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
