import QRCode from 'qrcode';
import type {
  QrStyleConfig,
  QrBodyShape,
  QrEyeFrameShape,
  QrEyeDotShape,
  QrCenterShape,
} from '../types';

// Preset verification emblems encoded as crisp SVG Data URIs
export interface PresetEmblem {
  id: string;
  name: string;
  svgDataUri: string;
}

export const PRESET_EMBLEMS: PresetEmblem[] = [
  {
    id: 'shield-check',
    name: 'Verified Shield',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%232563EB" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  },
  {
    id: 'award-ribbon',
    name: 'Award Ribbon',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23D97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`,
  },
  {
    id: 'graduation-cap',
    name: 'Graduation Cap',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%234F46E5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>`,
  },
  {
    id: 'star-badge',
    name: 'Excellence Star',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23EAB308" stroke="%23CA8A04" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  },
  {
    id: 'lock-check',
    name: 'Secure Cert',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="m10 16 1.5 1.5 3-3"/></svg>`,
  },
];

// In-memory image cache for instant canvas rendering without re-fetching
const imageElementCache = new Map<string, HTMLImageElement | ImageBitmap>();

export function getCachedImage(src: string): CanvasImageSource | null {
  const existing = imageElementCache.get(src);
  if (existing) {
    if ('complete' in existing) {
      if (existing.complete && existing.naturalWidth > 0) return existing;
    } else {
      return existing; // ImageBitmap
    }
  }
  if (typeof window !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageElementCache.set(src, img);
    };
    img.src = src;
    imageElementCache.set(src, img);
  } else if (typeof fetch !== 'undefined' && typeof createImageBitmap === 'function') {
    fetch(src)
      .then((res) => res.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        imageElementCache.set(src, bitmap);
      })
      .catch(() => {});
  }
  return null;
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
 * Draw Center Cutout Badge
 */
function drawCenterCutout(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  shape: QrCenterShape,
  bgColor: string
) {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();

  const x = cx - size / 2;
  const y = cy - size / 2;

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
    // Square
    ctx.rect(x, y, size, size);
  }

  ctx.fill();
  ctx.restore();
}

export interface DrawStyledQrOptions {
  x: number;
  y: number;
  size: number;
  text: string;
  style?: QrStyleConfig;
  logoImg?: CanvasImageSource | null;
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
  // Auto-elevate error correction to 'H' when a logo is used so scannability is 100% rock-solid
  const qr = QRCode.create(text, { errorCorrectionLevel: hasLogo ? 'H' : 'M' });

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

  // 1. Draw optional background
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, size, size);
  }

  // 2. Define Finder Pattern Areas (7x7 modules each at Top-Left, Top-Right, Bottom-Left)
  const isFinderModule = (r: number, c: number): boolean => {
    // Top-Left
    if (r < 7 && c < 7) return true;
    // Top-Right
    if (r < 7 && c >= moduleCount - 7) return true;
    // Bottom-Left
    if (r >= moduleCount - 7 && c < 7) return true;
    return false;
  };

  // 3. Define Center Logo Reservation Area
  let logoStartMod = -1;
  let logoEndMod = -1;
  let logoPxSize = 0;
  let logoCenterX = x + size / 2;
  let logoCenterY = y + size / 2;

  if (hasLogo) {
    // Reserve ~24% - 28% of module count in center (odd number of modules for perfect symmetry)
    let reservedMods = Math.max(5, Math.floor(moduleCount * 0.26));
    if (reservedMods % 2 === 0) reservedMods += 1;
    logoStartMod = Math.floor((moduleCount - reservedMods) / 2);
    logoEndMod = logoStartMod + reservedMods;
    // Slightly generous pixel size for cutout to give breathing room
    logoPxSize = (reservedMods + 0.6) * moduleSize;
  }

  const isLogoModule = (r: number, c: number): boolean => {
    if (!hasLogo) return false;
    return (
      r >= logoStartMod &&
      r < logoEndMod &&
      c >= logoStartMod &&
      c < logoEndMod
    );
  };

  // 4. Batch and Draw Body Modules
  const isDark = (r: number, c: number): boolean => {
    if (r < 0 || r >= moduleCount || c < 0 || c >= moduleCount) return false;
    if (isFinderModule(r, c)) return false;
    if (isLogoModule(r, c)) return false;
    return Boolean(qr.modules.get(r, c));
  };

  ctx.fillStyle = patternColor;
  ctx.beginPath();

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (!qr.modules.get(r, c)) continue;
      if (isFinderModule(r, c)) continue;
      if (isLogoModule(r, c)) continue;

      const mx = x + c * moduleSize;
      const my = y + r * moduleSize;

      const top = isDark(r - 1, c);
      const bottom = isDark(r + 1, c);
      const left = isDark(r, c - 1);
      const right = isDark(r, c + 1);

      if (bodyShape === 'square') {
        ctx.rect(mx, my, moduleSize, moduleSize);
      } else if (bodyShape === 'smooth') {
        // Fluid Connected Rounded: adjacent modules merge into continuous smooth pill/capsule shapes
        const rad = moduleSize * 0.5;
        const rTL = !top && !left ? rad : 0;
        const rTR = !top && !right ? rad : 0;
        const rBR = !bottom && !right ? rad : 0;
        const rBL = !bottom && !left ? rad : 0;
        addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [rTL, rTR, rBR, rBL]);
      } else if (bodyShape === 'rounded-connected' || bodyShape === 'rounded') {
        // Subtle Connected Rounded: contiguous blocks with refined outer corner rounding
        const rad = moduleSize * 0.3;
        const rTL = !top && !left ? rad : 0;
        const rTR = !top && !right ? rad : 0;
        const rBR = !bottom && !right ? rad : 0;
        const rBL = !bottom && !left ? rad : 0;
        addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [rTL, rTR, rBR, rBL]);
      } else if (bodyShape === 'horizontal') {
        // Horizontal Connected Bars: horizontal neighbors connect into sleek rounded pills
        const barH = moduleSize * 0.82;
        const barY = my + (moduleSize - barH) / 2;
        const rL = !left ? barH / 2 : 0;
        const rR = !right ? barH / 2 : 0;
        addRoundRectPath(ctx, mx, barY, moduleSize, barH, [rL, rR, rR, rL]);
      } else if (bodyShape === 'vertical') {
        // Vertical Connected Bars: vertical neighbors connect into sleek rounded pills
        const barW = moduleSize * 0.82;
        const barX = mx + (moduleSize - barW) / 2;
        const rT = !top ? barW / 2 : 0;
        const rB = !bottom ? barW / 2 : 0;
        addRoundRectPath(ctx, barX, my, barW, moduleSize, [rT, rT, rB, rB]);
      } else if (bodyShape === 'classy') {
        // Classy Diagonal: elegant diagonal rounded corners on exterior edges
        const rad = moduleSize * 0.45;
        const rTL = !top && !left ? rad : 0;
        const rBR = !bottom && !right ? rad : 0;
        addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [rTL, 0, rBR, 0]);
      } else if (bodyShape === 'classy-rounded') {
        // Classy Rounded: smooth connected diagonal contours
        const rad = moduleSize * 0.5;
        const rTL = !top && !left ? rad : 0;
        const rBR = !bottom && !right ? rad : 0;
        const rTR = !top && !right ? moduleSize * 0.2 : 0;
        const rBL = !bottom && !left ? moduleSize * 0.2 : 0;
        addRoundRectPath(ctx, mx, my, moduleSize, moduleSize, [rTL, rTR, rBR, rBL]);
      } else if (bodyShape === 'dots') {
        // Circular Dots
        const rad = moduleSize * 0.44;
        ctx.moveTo(mx + moduleSize / 2 + rad, my + moduleSize / 2);
        ctx.arc(mx + moduleSize / 2, my + moduleSize / 2, rad, 0, Math.PI * 2);
      } else if (bodyShape === 'extra-rounded') {
        // Individual Squircles
        addRoundRectPath(
          ctx,
          mx + moduleSize * 0.05,
          my + moduleSize * 0.05,
          moduleSize * 0.9,
          moduleSize * 0.9,
          moduleSize * 0.42
        );
      } else if (bodyShape === 'diamond') {
        // Diamond Modules
        const cx = mx + moduleSize / 2;
        const cy = my + moduleSize / 2;
        const half = moduleSize * 0.48;
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + half, cy);
        ctx.lineTo(cx, cy + half);
        ctx.lineTo(cx - half, cy);
        ctx.closePath();
      } else if (bodyShape === 'star') {
        // 4-Point Star Modules
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
        // Honeycomb Hexagon
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
        // Beveled Micro-Tiles
        addRoundRectPath(
          ctx,
          mx + moduleSize * 0.08,
          my + moduleSize * 0.08,
          moduleSize * 0.84,
          moduleSize * 0.84,
          moduleSize * 0.15
        );
      } else if (bodyShape === 'leaf') {
        // Leaf Modules
        addRoundRectPath(
          ctx,
          mx + moduleSize * 0.04,
          my + moduleSize * 0.04,
          moduleSize * 0.92,
          moduleSize * 0.92,
          [moduleSize * 0.46, 0, moduleSize * 0.46, 0]
        );
      }
    }
  }
  ctx.fill();

  // 5. Draw the Three Finder Eyes (Outer frame + Inner dot)
  const eyeSize = 7 * moduleSize;
  const eyeCoords = [
    { x, y }, // Top-Left
    { x: x + (moduleCount - 7) * moduleSize, y }, // Top-Right
    { x, y: y + (moduleCount - 7) * moduleSize }, // Bottom-Left
  ];

  for (const coord of eyeCoords) {
    drawEyeFrame(ctx, coord.x, coord.y, eyeSize, eyeFrameShape, eyeFrameColor);
    drawEyeDot(ctx, coord.x, coord.y, eyeSize, eyeDotShape, eyeDotColor);
  }

  // 6. Draw Center Cutout & Logo / Emblem
  if (hasLogo && logoPxSize > 0) {
    const cutoutBg = bgColor || '#ffffff';
    drawCenterCutout(ctx, logoCenterX, logoCenterY, logoPxSize, centerShape, cutoutBg);

    // Resolve logo image source
    let resolvedImg: CanvasImageSource | null = logoImg || null;
    if (!resolvedImg && style?.logo) {
      resolvedImg = getCachedImage(style.logo);
    }

    if (resolvedImg) {
      const innerLogoSize = logoPxSize * 0.72;
      const lx = logoCenterX - innerLogoSize / 2;
      const ly = logoCenterY - innerLogoSize / 2;

      ctx.save();
      // Clip to cutout shape with padding
      ctx.beginPath();
      if (centerShape === 'circle') {
        ctx.arc(logoCenterX, logoCenterY, innerLogoSize / 2 + 1, 0, Math.PI * 2);
      } else if (centerShape === 'rounded') {
        addRoundRectPath(
          ctx,
          lx - 1,
          ly - 1,
          innerLogoSize + 2,
          innerLogoSize + 2,
          innerLogoSize * 0.22
        );
      } else {
        ctx.rect(lx - 1, ly - 1, innerLogoSize + 2, innerLogoSize + 2);
      }
      ctx.clip();

      ctx.drawImage(resolvedImg, lx, ly, innerLogoSize, innerLogoSize);
      ctx.restore();
    }
  }

  ctx.restore();
}
