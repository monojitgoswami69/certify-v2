/**
 * Shared export resolution and compression policy for downloads and emailed
 * certificates across main-thread and Web Worker renderers.
 *
 * Low-resolution templates (e.g. 842x595 72-DPI A4 exports) leave tiny QR zones
 * (~65px) with ~1.3px per QR module, which smears into unscannable blur when
 * rasterized at 1x or JPEG-compressed. Supersampling to >= 2400px longest edge
 * renders vector text, QR modules, and high-res logos crisply while keeping the
 * PDF's logical page size unchanged.
 */

export const MIN_EXPORT_LONG_EDGE = 2400;
export const MAX_EXPORT_SCALE = 3;
export const MAX_EXPORT_PIXELS = 24_000_000;
export const EXPORT_JPEG_QUALITY = 0.96;
/** Prefer lossless PNG inside PDFs up to 6 MB to preserve crisp text & QR edges. */
export const PDF_MAX_PNG_BYTES = 6 * 1024 * 1024;

export function computeExportScale(width: number, height: number): number {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const longest = Math.max(safeW, safeH);
  if (longest >= MIN_EXPORT_LONG_EDGE) return 1;

  const desired = Math.min(MAX_EXPORT_SCALE, Math.ceil(MIN_EXPORT_LONG_EDGE / longest));
  const area = safeW * safeH;
  let scale = desired;
  while (scale > 1 && area * scale * scale > MAX_EXPORT_PIXELS) {
    scale -= 1;
  }
  return Math.max(1, scale);
}
