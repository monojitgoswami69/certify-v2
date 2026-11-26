import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESET_EMBLEMS, drawStyledQr, ensureSvgDataUriDimensions } from './qr-renderer';
import type { QrCenterShape } from '../types';

const originalOffscreenCanvas = globalThis.OffscreenCanvas;

afterEach(() => {
  globalThis.OffscreenCanvas = originalOffscreenCanvas;
});

function createMock2dContext() {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1 })),
  };
}

describe('qr-renderer', () => {
  it('ensures SVG data URIs carry explicit pixel dimensions for Web Worker decoding', () => {
    for (const emblem of PRESET_EMBLEMS) {
      expect(emblem.svgDataUri).toContain('width="256"');
      expect(emblem.svgDataUri).toContain('height="256"');
    }

    const unsized = 'data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22%232563EB%22%3E%3C/svg%3E';
    const patched = ensureSvgDataUriDimensions(unsized, 128);
    expect(decodeURIComponent(patched)).toContain('width="128" height="128"');
    expect(patched).not.toContain('#2563EB'); // `#` must stay percent-encoded in data URIs!

    const alreadySized = 'data:image/svg+xml;utf8,<svg width="64" height="64"></svg>';
    expect(ensureSvgDataUriDimensions(alreadySized, 128)).toBe(alreadySized);
    expect(ensureSvgDataUriDimensions('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('clips cutout logos across circle, rounded, shield, diamond, and square shapes', () => {
    const shapes: QrCenterShape[] = ['circle', 'rounded', 'shield', 'diamond', 'square'];
    const logoImg = { width: 64, height: 64 } as unknown as HTMLImageElement;

    for (const centerShape of shapes) {
      const ctx = createMock2dContext();
      drawStyledQr(ctx as unknown as CanvasRenderingContext2D, {
        x: 10,
        y: 20,
        size: 160,
        text: `https://verify.example/cert-${centerShape}`,
        style: {
          bodyShape: centerShape === 'square' ? 'square' : 'smooth',
          eyeFrameShape: 'rounded',
          eyeDotShape: 'rounded',
          centerShape,
          logo: PRESET_EMBLEMS[0].svgDataUri,
        },
        logoImg,
      });

      expect(ctx.clip).toHaveBeenCalledTimes(1);
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
      expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
    }
  });

  it('keeps the center logo cutout transparent by default and paints it only when a solid background is set', () => {
    const logoImg = { width: 64, height: 64 } as unknown as HTMLImageElement;

    const transparentCtx = createMock2dContext();
    drawStyledQr(transparentCtx as unknown as CanvasRenderingContext2D, {
      x: 0,
      y: 0,
      size: 160,
      text: 'https://verify.example/transparent-logo',
      style: {
        patternColor: '#111111',
        backgroundColor: 'transparent',
        centerShape: 'rounded',
        logo: PRESET_EMBLEMS[0].svgDataUri,
      },
      logoImg,
    });
    expect(transparentCtx.fillRect).not.toHaveBeenCalled();
    // 1 body fill + 3 eye-frame fills + 3 eye-dot fills = 7 fills (no opaque white center cutout fill).
    expect(transparentCtx.fill).toHaveBeenCalledTimes(7);

    const solidCtx = createMock2dContext();
    drawStyledQr(solidCtx as unknown as CanvasRenderingContext2D, {
      x: 0,
      y: 0,
      size: 160,
      text: 'https://verify.example/solid-logo',
      style: {
        patternColor: '#111111',
        backgroundColor: '#FFE4E6',
        centerShape: 'rounded',
        logo: PRESET_EMBLEMS[0].svgDataUri,
      },
      logoImg,
    });
    expect(solidCtx.fillRect).toHaveBeenCalledWith(0, 0, 160, 160);
    // Adds 1 cutout fill matching the solid background.
    expect(solidCtx.fill).toHaveBeenCalledTimes(8);
  });

  it('promotes repeated identical QR paints to cached sprites without caching one-off URLs', () => {
    const createdSprites: Array<{ width: number; height: number; ctx: ReturnType<typeof createMock2dContext> }> = [];
    class MockOffscreenCanvas {
      width: number;
      height: number;
      private ctx = createMock2dContext();
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        createdSprites.push({ width, height, ctx: this.ctx });
      }
      getContext() {
        return this.ctx;
      }
    }
    globalThis.OffscreenCanvas = MockOffscreenCanvas as unknown as typeof OffscreenCanvas;

    // 10 unique batch URLs should each hit vector drawing with zero sprite allocations
    for (let i = 0; i < 10; i++) {
      const batchCtx = createMock2dContext();
      drawStyledQr(batchCtx as unknown as CanvasRenderingContext2D, {
        x: 0,
        y: 0,
        size: 140,
        text: `https://verify.example/batch-unique-${i}`,
      });
      expect(batchCtx.drawImage).not.toHaveBeenCalled();
    }
    expect(createdSprites).toHaveLength(0);

    // Repeated static QR (editor drag / hover) promotes on 2nd hit and blits cleanly on 3rd hit
    const style = { bodyShape: 'square' as const };
    const ctx1 = createMock2dContext();
    drawStyledQr(ctx1 as unknown as CanvasRenderingContext2D, { x: 0, y: 0, size: 120, text: 'https://verify.example/static-sample', style });
    expect(createdSprites).toHaveLength(0);

    const ctx2 = createMock2dContext();
    drawStyledQr(ctx2 as unknown as CanvasRenderingContext2D, { x: 5, y: 5, size: 120, text: 'https://verify.example/static-sample', style });
    expect(createdSprites).toHaveLength(1);
    expect(ctx2.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx2.fillRect).not.toHaveBeenCalled();

    const ctx3 = createMock2dContext();
    drawStyledQr(ctx3 as unknown as CanvasRenderingContext2D, { x: 15, y: 15, size: 120, text: 'https://verify.example/static-sample', style });
    expect(createdSprites).toHaveLength(1);
    expect(ctx3.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx3.fillRect).not.toHaveBeenCalled();
  });
});
