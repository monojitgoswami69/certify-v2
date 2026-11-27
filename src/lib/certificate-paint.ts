import type { ImageElement, QrStyleConfig, TextBox } from '../types';
import { drawCertificateText } from './certificate-text';
import { drawStyledQr } from './qr-renderer';
import { SAMPLE_QR_URL } from './verification-links';

export interface QrPlacement {
  x: number;
  y: number;
  size: number;
  style?: QrStyleConfig;
}

type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function paintCertificate(ctx: DrawingContext, scene: {
  artwork: CanvasImageSource;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  images?: readonly { el: ImageElement; image: CanvasImageSource | null }[];
  qrZones?: readonly QrPlacement[];
  getLogo?: (src: string) => CanvasImageSource | null | undefined;
  verificationUrl?: string;
  sampleQr?: boolean;
  text: Iterable<{ box: TextBox; value: string; font: string }>;
}) {
  const { width, height, targetWidth, targetHeight } = scene;
  const scaleX = targetWidth / Math.max(1, width);
  const scaleY = targetHeight / Math.max(1, height);
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.save();
  try {
    if (scaleX !== 1 || scaleY !== 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(scaleX, scaleY);
    }
    ctx.drawImage(scene.artwork, 0, 0, width, height);

    for (const { el, image } of scene.images ?? []) {
      if (!image) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity ?? 1));
      ctx.drawImage(image, el.x, el.y, el.w, el.h);
      ctx.restore();
    }

    const verifyText = scene.sampleQr ? SAMPLE_QR_URL : scene.verificationUrl;
    if (verifyText) {
      for (const zone of scene.qrZones ?? []) {
        const src = zone.style?.logo;
        drawStyledQr(ctx, { ...zone, text: verifyText, logoImg: src ? scene.getLogo?.(src) : null });
        if (scene.sampleQr) {
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

    for (const { box, value, font } of scene.text) drawCertificateText(ctx, value, box, font);
  } finally {
    ctx.restore();
  }
}
