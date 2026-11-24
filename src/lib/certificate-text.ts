import type { TextBox } from '../types';

type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const fittingCaches = new WeakMap<TextContext, Map<string, number>>();

export function clearTextMeasurements(ctx: TextContext) {
  fittingCaches.delete(ctx);
}

/** Layout coordinates and font sizes are always in template pixels. */
export function defaultCertificateFontSize(width: number, height: number): number {
  return Math.max(1, Math.round(Math.min(width, height) * 0.06));
}

function fittedSize(
  ctx: TextContext,
  text: string,
  font: string,
  cap: number,
  width: number,
  height: number
): number {
  let cache = fittingCaches.get(ctx);
  if (!cache) {
    cache = new Map();
    fittingCaches.set(ctx, cache);
  }
  const key = JSON.stringify([font, cap, width, height, text]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const maximum = Math.min(cap, height / 1.2);
  const fits = (size: number) => {
    ctx.font = `${size}px ${font}`;
    return ctx.measureText(text).width <= width;
  };

  let size = maximum;
  if (!fits(maximum)) {
    let low = 0;
    let high = maximum;
    // Fractional sizes keep narrow boxes usable even on very small artwork.
    while (high - low > 0.25) {
      const candidate = (low + high) / 2;
      if (fits(candidate)) low = candidate;
      else high = candidate;
    }
    size = Math.max(Math.min(maximum, 0.25), low);
  }

  if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
  cache.set(key, size);
  return size;
}

export function drawCertificateText(ctx: TextContext, text: string, box: TextBox, font: string) {
  if (!text.trim() || !(box.w > 0 && box.h > 0 && box.fontSize > 0)) return;

  const paddingX = Math.min(5, box.w / 8);
  const paddingBottom = Math.min(8, box.h / 8);
  const width = box.w - paddingX * 2;
  const height = box.h - paddingBottom;

  ctx.save();
  const size = fittedSize(ctx, text, font, box.fontSize, width, height);
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = box.fontColor;
  ctx.textAlign = box.hAlign || 'center';
  ctx.textBaseline = 'alphabetic';

  const x = box.x + (ctx.textAlign === 'left' ? paddingX
    : ctx.textAlign === 'right' ? box.w - paddingX : box.w / 2);
  const y = box.y + (box.vAlign === 'top' ? size
    : box.vAlign === 'middle' ? (box.h + size) / 2 - Math.min(2, paddingBottom) : box.h - paddingBottom);

  ctx.fillText(text, x, y, width);
  ctx.restore();
}
