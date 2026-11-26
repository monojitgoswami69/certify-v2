import QRCode from 'qrcode';
import type {
  QrStyleConfig,
  QrBodyShape,
  QrEyeFrameShape,
  QrEyeDotShape,
  QrCenterShape,
} from '../types';

/**
 * LRU cache for QR bit matrices. QRCode.create runs Reed-Solomon ECC —
 * ~0.5-2ms per call — and the editor redraws QR zones (a constant URL) at
 * drag frame rate, so memoizing by `text|ecLevel` removes that cost entirely
 * for repeated paints. Bounded so worker-driven unique URLs can't grow it.
 */
const QR_MATRIX_CACHE_LIMIT = 64;
const qrMatrixCache = new Map<string, ReturnType<typeof QRCode.create>>();

function getCachedQrMatrix(text: string, errorCorrectionLevel: 'H' | 'M') {
  const key = `${errorCorrectionLevel}|${text}`;
  const cached = qrMatrixCache.get(key);
  if (cached) {
    // refresh recency
    qrMatrixCache.delete(key);
    qrMatrixCache.set(key, cached);
    return cached;
  }
  const created = QRCode.create(text, { errorCorrectionLevel });
  if (qrMatrixCache.size >= QR_MATRIX_CACHE_LIMIT) {
    const oldest = qrMatrixCache.keys().next().value;
    if (oldest !== undefined) qrMatrixCache.delete(oldest);
  }
  qrMatrixCache.set(key, created);
  return created;
}

// Preset verification emblems encoded as crisp SVG Data URIs with explicit
// dimensions so Worker `createImageBitmap()` decodes them reliably across engines.
export interface PresetEmblem {
  id: string;
  name: string;
  svgDataUri: string;
}

export const PRESET_EMBLEMS: PresetEmblem[] = [
  {
    id: 'shield-check',
    name: 'Verified Shield',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="%232563EB" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  },
  {
    id: 'award-ribbon',
    name: 'Award Ribbon',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="%23D97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`,
  },
  {
    id: 'graduation-cap',
    name: 'Graduation Cap',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="%234F46E5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>`,
  },
  {
    id: 'star-badge',
    name: 'Excellence Star',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="%23EAB308" stroke="%23CA8A04" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  },
  {
    id: 'lock-check',
    name: 'Secure Cert',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="%23059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="m10 16 1.5 1.5 3-3"/></svg>`,
  },
];

// Preview decoding is shared by redraws and their load listeners.
const imageElementCache = new Map<string, HTMLImageElement>();

function getQrImage(src: string): HTMLImageElement {
  const cached = imageElementCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.addEventListener('error', () => {
    if (imageElementCache.get(src) === image) imageElementCache.delete(src);
  });
  image.src = src;
  if (imageElementCache.size >= 24) {
    const oldest = imageElementCache.keys().next().value;
    if (oldest !== undefined) imageElementCache.delete(oldest);
  }
  imageElementCache.set(src, image);
  return image;
}

function getCachedImage(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const image = getQrImage(src);
  return image.complete && image.naturalWidth > 0 ? image : null;
}

export function subscribeToQrImage(src: string, onLoad: () => void): () => void {
  const image = getQrImage(src);
  let active = true;
  if (image.complete && image.naturalWidth > 0) {
    queueMicrotask(() => {
      if (active) onLoad();
    });
    return () => {
      active = false;
    };
  }
  const handleLoad = () => {
    if (active) onLoad();
  };
  image.addEventListener('load', handleLoad, { once: true });
  return () => {
    active = false;
    image.removeEventListener('load', handleLoad);
  };
}

// Canvas-safe roundRect fallback
function addRoundRectPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | number[]
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radii);
    return;
  }

  // Manual fallback using arcTo
  let rTL = 0,
    rTR = 0,
    rBR = 0,
    rBL = 0;
  if (typeof radii === 'number') {
    rTL = rTR = rBR = rBL = Math.min(radii, w / 2, h / 2);
  } else if (Array.isArray(radii)) {
    if (radii.length === 1) {
      rTL = rTR = rBR = rBL = radii[0];
    } else if (radii.length === 2) {
      rTL = rBR = radii[0];
      rTR = rBL = radii[1];
    } else if (radii.length === 4) {
      [rTL, rTR, rBR, rBL] = radii;
    }
  }

  ctx.moveTo(x + rTL, y);
  ctx.lineTo(x + w - rTR, y);
  ctx.arcTo(x + w, y, x + w, y + rTR, rTR);
  ctx.lineTo(x + w, y + h - rBR);
  ctx.arcTo(x + w, y + h, x + w - rBR, y + h, rBR);
  ctx.lineTo(x + rBL, y + h);
  ctx.arcTo(x, y + h, x, y + h - rBL, rBL);
  ctx.lineTo(x, y + rTL);
  ctx.arcTo(x, y, x + rTL, y, rTL);
  ctx.closePath();
}

/**
 * Draw Eye Frame (Outer 7x7 module border with 1-module hollow ring)
 */
function drawEyeFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: QrEyeFrameShape,
  color: string
) {
  const s = size / 7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();

  if (shape === 'square') {
    // Outer 7x7 rect
    ctx.rect(x, y, size, size);
    // Inner 5x5 cutout (offset 1 module)
    ctx.rect(x + s, y + s, size - 2 * s, size - 2 * s);
  } else if (shape === 'rounded') {
    addRoundRectPath(ctx, x, y, size, size, s * 1.5);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, s * 0.75);
  } else if (shape === 'extra-rounded') {
    addRoundRectPath(ctx, x, y, size, size, s * 2.5);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, s * 1.25);
  } else if (shape === 'circle') {
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, size / 2 - s, 0, Math.PI * 2, true);
  } else if (shape === 'leaf') {
    const rOuter = s * 2.6;
    const rInner = s * 1.3;
    addRoundRectPath(ctx, x, y, size, size, [rOuter, 0, rOuter, 0]);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, [rInner, 0, rInner, 0]);
  } else if (shape === 'leaf-inverted') {
    const rOuter = s * 2.6;
    const rInner = s * 1.3;
    addRoundRectPath(ctx, x, y, size, size, [0, rOuter, 0, rOuter]);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, [0, rInner, 0, rInner]);
  } else if (shape === 'pointed-leaf') {
    const rOuter = s * 2.6;
    const rInner = s * 1.3;
    addRoundRectPath(ctx, x, y, size, size, [0, rOuter, rOuter, rOuter]);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, [0, rInner, rInner, rInner]);
  } else if (shape === 'shield') {
    addRoundRectPath(ctx, x, y, size, size, [s * 0.5, s * 0.5, s * 3.2, s * 3.2]);
    addRoundRectPath(ctx, x + s, y + s, size - 2 * s, size - 2 * s, [s * 0.2, s * 0.2, s * 2.2, s * 2.2]);
  } else if (shape === 'diamond') {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const half = size / 2;
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
    const inHalf = half - s * 1.2;
    ctx.moveTo(cx, cy - inHalf);
    ctx.lineTo(cx - inHalf, cy);
    ctx.lineTo(cx, cy + inHalf);
    ctx.lineTo(cx + inHalf, cy);
    ctx.closePath();
  }

  ctx.fill('evenodd');
  ctx.restore();
}

/**
 * Draw Eye Center Dot (Inner 3x3 modules)
 */
function drawEyeDot(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: QrEyeDotShape,
  color: string
) {
  const s = size / 7;
  const dotX = x + 2 * s;
  const dotY = y + 2 * s;
  const dotSize = 3 * s;
  const cx = x + size / 2;
  const cy = y + size / 2;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();

  if (shape === 'square') {
    ctx.rect(dotX, dotY, dotSize, dotSize);
  } else if (shape === 'dot') {
    ctx.arc(cx, cy, dotSize / 2, 0, Math.PI * 2);
  } else if (shape === 'rounded') {
    addRoundRectPath(ctx, dotX, dotY, dotSize, dotSize, s * 0.9);
  } else if (shape === 'diamond') {
    const half = dotSize / 2;
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
  } else if (shape === 'star') {
    const rOut = dotSize / 2;
    ctx.moveTo(cx, cy - rOut);
    ctx.quadraticCurveTo(cx, cy, cx + rOut, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + rOut);
    ctx.quadraticCurveTo(cx, cy, cx - rOut, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - rOut);
    ctx.closePath();
  } else if (shape === 'cross') {
    const armW = s * 1.0;
    const armL = dotSize;
    ctx.rect(cx - armW / 2, dotY, armW, armL);
    ctx.rect(dotX, cy - armW / 2, armL, armW);
  } else if (shape === 'leaf') {
    addRoundRectPath(ctx, dotX, dotY, dotSize, dotSize, [s * 1.4, 0, s * 1.4, 0]);
  } else if (shape === 'ring') {
    ctx.arc(cx, cy, dotSize / 2, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, dotSize * 0.25, 0, Math.PI * 2, true);
  }

  ctx.fill('evenodd');
  ctx.restore();
}

/**
 * Traces the center badge path on the active 2D context so cutout fill and logo clipping match identically.
 */
function traceCenterShapePath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  shape: QrCenterShape
) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  } else if (shape === 'rounded') {
    addRoundRectPath(ctx, x, y, size, size, size * 0.24);
  } else if (shape === 'shield') {
    addRoundRectPath(ctx, x, y, size, size, [size * 0.1, size * 0.1, size * 0.45, size * 0.45]);
  } else if (shape === 'diamond') {
    const half = size / 2;
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
  } else {
    ctx.rect(x, y, size, size);
  }
}

/**
 * Ensures inline SVG data URIs carry explicit pixel dimensions so `createImageBitmap`
 * in Web Workers always rasterizes at crisp high resolution instead of failing or returning 0x0.
 */
export function ensureSvgDataUriDimensions(src: string, size = 256): string {
  if (!src.startsWith('data:image/svg+xml')) return src;
  const commaIdx = src.indexOf(',');
  if (commaIdx === -1) return src;
  const meta = src.slice(0, commaIdx);
  const body = src.slice(commaIdx + 1);
  if (/;base64/i.test(meta)) return src;
  let decoded: string;
  try {
    decoded = decodeURIComponent(body);
  } catch {
    decoded = body;
  }
  if (/\bwidth\s*=/.test(decoded) && /\bheight\s*=/.test(decoded)) return src;
  const patched = decoded.replace('<svg', `<svg width="${size}" height="${size}"`);
  return `${meta},${encodeURIComponent(patched)}`;
}

export interface DrawStyledQrOptions {
  x: number;
  y: number;
  size: number;
  text: string;
  style?: QrStyleConfig;
  logoImg?: CanvasImageSource | null;
}

type QrSprite = OffscreenCanvas | HTMLCanvasElement;
const QR_SPRITE_CACHE_LIMIT = 24;
const qrSpriteHits = new Map<string, number>();
const qrSpriteCache = new Map<string, QrSprite>();

function createSpriteSurface(pixelSize: number): QrSprite | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(pixelSize, pixelSize);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = pixelSize;
    c.height = pixelSize;
    return c;
  }
  return null;
}

function renderStyledQrVectors(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  text: string,
  style: QrStyleConfig | undefined,
  resolvedImg: CanvasImageSource | null,
  hasLogo: boolean
): void {
  const qr = getCachedQrMatrix(text, hasLogo ? 'H' : 'M');
  const moduleCount = qr.modules.size;
  const moduleSize = size / moduleCount;

  const bodyShape: QrBodyShape = style?.bodyShape || 'smooth';
  const eyeFrameShape: QrEyeFrameShape = style?.eyeFrameShape || 'rounded';
  const eyeDotShape: QrEyeDotShape = style?.eyeDotShape || 'rounded';
  const centerShape: QrCenterShape = style?.centerShape || 'rounded';

  const patternColor = style?.patternColor || '#000000';
  const eyeFrameColor = style?.eyeFrameColor || patternColor;
  const eyeDotColor = style?.eyeDotColor || patternColor;
  const bgColor = style?.backgroundColor && style.backgroundColor !== 'transparent' ? style.backgroundColor : null;

  ctx.save();

  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, size, size);
  }

  let logoStartMod = -1;
  let logoEndMod = -1;
  let logoPxSize = 0;
  const logoCenterX = x + size / 2;
  const logoCenterY = y + size / 2;

  if (hasLogo) {
    let reservedMods = Math.max(5, Math.floor(moduleCount * 0.26));
    if (reservedMods % 2 === 0) reservedMods += 1;
    logoStartMod = Math.floor((moduleCount - reservedMods) / 2);
    logoEndMod = logoStartMod + reservedMods;
    logoPxSize = (reservedMods + 0.6) * moduleSize;
  }

  // Precompute a flat active-body grid once so neighbor checks are direct byte reads.
  const activeBody = new Uint8Array(moduleCount * moduleCount);
  for (let r = 0; r < moduleCount; r++) {
    const inTopFinderRow = r < 7;
    const inBottomFinderRow = r >= moduleCount - 7;
    const inLogoRow = hasLogo && r >= logoStartMod && r < logoEndMod;
    const rowOffset = r * moduleCount;
    for (let c = 0; c < moduleCount; c++) {
      if (!qr.modules.get(r, c)) continue;
      if ((inTopFinderRow && (c < 7 || c >= moduleCount - 7)) || (inBottomFinderRow && c < 7)) continue;
      if (inLogoRow && c >= logoStartMod && c < logoEndMod) continue;
      activeBody[rowOffset + c] = 1;
    }
  }

  ctx.fillStyle = patternColor;
  ctx.beginPath();

  if (bodyShape === 'square') {
    // Merge adjacent horizontal cells into single rects to cut path ops dramatically.
    for (let r = 0; r < moduleCount; r++) {
      const my = y + r * moduleSize;
      const rowOffset = r * moduleCount;
      let c = 0;
      while (c < moduleCount) {
        if (!activeBody[rowOffset + c]) {
          c++;
          continue;
        }
        const startC = c;
        while (c < moduleCount && activeBody[rowOffset + c]) c++;
        ctx.rect(x + startC * moduleSize, my, (c - startC) * moduleSize, moduleSize);
      }
    }
  } else {
    for (let r = 0; r < moduleCount; r++) {
      const my = y + r * moduleSize;
      const rowOffset = r * moduleCount;
      for (let c = 0; c < moduleCount; c++) {
        if (!activeBody[rowOffset + c]) continue;

        const mx = x + c * moduleSize;
        const top = r > 0 && activeBody[rowOffset - moduleCount + c] === 1;
        const bottom = r + 1 < moduleCount && activeBody[rowOffset + moduleCount + c] === 1;
        const left = c > 0 && activeBody[rowOffset + c - 1] === 1;
        const right = c + 1 < moduleCount && activeBody[rowOffset + c + 1] === 1;

        if (bodyShape === 'smooth') {
          const rad = moduleSize * 0.5;
          addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [
            !top && !left ? rad : 0,
            !top && !right ? rad : 0,
            !bottom && !right ? rad : 0,
            !bottom && !left ? rad : 0,
          ]);
        } else if (bodyShape === 'rounded-connected' || bodyShape === 'rounded') {
          const rad = moduleSize * 0.3;
          addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [
            !top && !left ? rad : 0,
            !top && !right ? rad : 0,
            !bottom && !right ? rad : 0,
            !bottom && !left ? rad : 0,
          ]);
        } else if (bodyShape === 'horizontal') {
          const barH = moduleSize * 0.82;
          const barY = my + (moduleSize - barH) / 2;
          addRoundRectPath(ctx, mx, barY, moduleSize, barH, [
            !left ? barH / 2 : 0,
            !right ? barH / 2 : 0,
            !right ? barH / 2 : 0,
            !left ? barH / 2 : 0,
          ]);
        } else if (bodyShape === 'vertical') {
          const barW = moduleSize * 0.82;
          const barX = mx + (moduleSize - barW) / 2;
          addRoundRectPath(ctx, barX, my, barW, moduleSize, [
            !top ? barW / 2 : 0,
            !top ? barW / 2 : 0,
            !bottom ? barW / 2 : 0,
            !bottom ? barW / 2 : 0,
          ]);
        } else if (bodyShape === 'classy') {
          const rad = moduleSize * 0.45;
          addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [
            !top && !left ? rad : 0,
            0,
            !bottom && !right ? rad : 0,
            0,
          ]);
        } else if (bodyShape === 'classy-rounded') {
          const rad = moduleSize * 0.5;
          addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [
            !top && !left ? rad : 0,
            !top && !right ? moduleSize * 0.2 : 0,
            !bottom && !right ? rad : 0,
            !bottom && !left ? moduleSize * 0.2 : 0,
          ]);
        } else if (bodyShape === 'dots') {
          const rad = moduleSize * 0.44;
          ctx.moveTo(mx + moduleSize / 2 + rad, my + moduleSize / 2);
          ctx.arc(mx + moduleSize / 2, my + moduleSize / 2, rad, 0, Math.PI * 2);
        } else if (bodyShape === 'extra-rounded') {
          addRoundRectPath(ctx, mx + moduleSize * 0.05, my + moduleSize * 0.05, moduleSize * 0.9, moduleSize * 0.9, moduleSize * 0.42);
        } else if (bodyShape === 'diamond') {
          const cx = mx + moduleSize / 2;
          const cy = my + moduleSize / 2;
          const half = moduleSize * 0.48;
          ctx.moveTo(cx, cy - half);
          ctx.lineTo(cx + half, cy);
          ctx.lineTo(cx, cy + half);
          ctx.lineTo(cx - half, cy);
          ctx.closePath();
        } else if (bodyShape === 'star') {
          const cx = mx + moduleSize / 2;
          const cy = my + moduleSize / 2;
          const rOut = moduleSize * 0.48;
          ctx.moveTo(cx, cy - rOut);
          ctx.quadraticCurveTo(cx, cy, cx + rOut, cy);
          ctx.quadraticCurveTo(cx, cy, cx, cy + rOut);
          ctx.quadraticCurveTo(cx, cy, cx - rOut, cy);
          ctx.quadraticCurveTo(cx, cy, cx, cy - rOut);
          ctx.closePath();
        } else if (bodyShape === 'hexagon') {
          const cx = mx + moduleSize / 2;
          const cy = my + moduleSize / 2;
          const r = moduleSize * 0.48;
          for (let a = 0; a < 6; a++) {
            const angle = (Math.PI / 3) * a - Math.PI / 6;
            const px = cx + r * Math.cos(angle);
            const py = cy + r * Math.sin(angle);
            if (a === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else if (bodyShape === 'mosaic') {
          addRoundRectPath(ctx, mx + moduleSize * 0.08, my + moduleSize * 0.08, moduleSize * 0.84, moduleSize * 0.84, moduleSize * 0.15);
        } else if (bodyShape === 'leaf') {
          addRoundRectPath(ctx, mx + moduleSize * 0.04, my + moduleSize * 0.04, moduleSize * 0.92, moduleSize * 0.92, [
            moduleSize * 0.46, 0, moduleSize * 0.46, 0,
          ]);
        }
      }
    }
  }
  ctx.fill();

  const eyeSize = 7 * moduleSize;
  const eyeCoords = [
    { x, y },
    { x: x + (moduleCount - 7) * moduleSize, y },
    { x, y: y + (moduleCount - 7) * moduleSize },
  ];

  for (const coord of eyeCoords) {
    drawEyeFrame(ctx, coord.x, coord.y, eyeSize, eyeFrameShape, eyeFrameColor);
    drawEyeDot(ctx, coord.x, coord.y, eyeSize, eyeDotShape, eyeDotColor);
  }

  if (hasLogo && logoPxSize > 0) {
    // Keep the center logo cutout transparent by default so template artwork shows
    // through cleanly; only paint a cutout fill when a solid QR background is chosen.
    if (bgColor) {
      ctx.save();
      ctx.fillStyle = bgColor;
      traceCenterShapePath(ctx, logoCenterX, logoCenterY, logoPxSize, centerShape);
      ctx.fill();
      ctx.restore();
    }

    if (resolvedImg) {
      const innerLogoSize = logoPxSize * 0.72;
      const lx = logoCenterX - innerLogoSize / 2;
      const ly = logoCenterY - innerLogoSize / 2;

      ctx.save();
      traceCenterShapePath(ctx, logoCenterX, logoCenterY, innerLogoSize + 2, centerShape);
      ctx.clip();
      ctx.drawImage(resolvedImg, lx, ly, innerLogoSize, innerLogoSize);
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * High-performance, vector-antialiased QR code renderer supporting custom body patterns,
 * corner eye shapes, custom colors, and center logo cutouts.
 */
export function drawStyledQr(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: DrawStyledQrOptions
): void {
  const { x, y, size, text, style, logoImg } = options;
  if (!text || size <= 0) return;

  const hasLogo = Boolean(style?.logo || logoImg);
  let resolvedImg: CanvasImageSource | null = logoImg || null;
  if (!resolvedImg && style?.logo) {
    resolvedImg = getCachedImage(style.logo);
  }

  // Only promote repeated static QR draws (editor drags/previews/hovers) into the
  // bitmap sprite cache so single-use batch export URLs pay zero sprite memory overhead.
  const canCacheSprite = (!hasLogo || Boolean(resolvedImg)) && !logoImg;
  if (canCacheSprite && typeof ctx.getTransform === 'function') {
    const t = ctx.getTransform();
    const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d), 1);
    const rasterSize = Math.min(1024, Math.max(16, Math.ceil(size * scale)));
    const spriteKey = [
      text,
      rasterSize,
      style?.bodyShape || 'smooth',
      style?.eyeFrameShape || 'rounded',
      style?.eyeDotShape || 'rounded',
      style?.centerShape || 'rounded',
      style?.patternColor || '#000000',
      style?.eyeFrameColor || '',
      style?.eyeDotColor || '',
      style?.backgroundColor || 'transparent',
      style?.logo || '',
    ].join('\0');

    const cachedSprite = qrSpriteCache.get(spriteKey);
    if (cachedSprite) {
      qrSpriteCache.delete(spriteKey);
      qrSpriteCache.set(spriteKey, cachedSprite);
      ctx.drawImage(cachedSprite, x, y, size, size);
      return;
    }

    const hits = (qrSpriteHits.get(spriteKey) ?? 0) + 1;
    if (hits >= 2) {
      const surface = createSpriteSurface(rasterSize);
      const sctx = surface?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (surface && sctx) {
        renderStyledQrVectors(sctx, 0, 0, rasterSize, text, style, resolvedImg, hasLogo);
        if (qrSpriteCache.size >= QR_SPRITE_CACHE_LIMIT) {
          const oldest = qrSpriteCache.keys().next().value;
          if (oldest !== undefined) qrSpriteCache.delete(oldest);
        }
        qrSpriteCache.set(spriteKey, surface);
        qrSpriteHits.delete(spriteKey);
        ctx.drawImage(surface, x, y, size, size);
        return;
      }
    } else {
      if (qrSpriteHits.size >= QR_SPRITE_CACHE_LIMIT * 4) qrSpriteHits.clear();
      qrSpriteHits.set(spriteKey, hits);
    }
  }

  renderStyledQrVectors(ctx, x, y, size, text, style, resolvedImg, hasLogo);
}
