import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextBox } from '../types';
import {
  drawCertificateToCanvas,
  generateCertificate,
  renderCertificatePreviewBlob,
} from './certificate-engine';
import { computeExportScale, EXPORT_JPEG_QUALITY, PDF_MAX_PNG_BYTES } from './export-scale';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

function createMockCanvas() {
  const ctx = {
    font: '24px Inter',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    textAlign: 'center',
    textBaseline: 'middle',
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1 })),
  };

  const toBlob = vi.fn(
    (cb: (blob: Blob | null) => void, mime: string) => {
      cb(new Blob(['mock'], { type: mime }));
    }
  );

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob,
  };

  return { canvas, ctx, toBlob };
}

const SAMPLE_BOX: TextBox = {
  id: 'name',
  field: 'Name',
  x: 1000,
  y: 2000,
  w: 800,
  h: 120,
  fontSize: 48,
  fontFamily: 'Inter',
  fontColor: '#111111',
  hAlign: 'center',
  vAlign: 'middle',
};

describe('certificate-engine preview scaling', () => {
  it('draws scaled previews from full logical template coordinates without allocating a 4K canvas', async () => {
    const { canvas, ctx } = createMockCanvas();
    const previewImg = { naturalWidth: 700, naturalHeight: 1400, width: 700, height: 1400 } as HTMLImageElement;

    await drawCertificateToCanvas({
      templateImage: previewImg,
      logicalWidth: 2000,
      logicalHeight: 4000,
      targetWidth: 700,
      targetHeight: 1400,
      boxes: [SAMPLE_BOX],
      row: { Name: 'Ada Lovelace' },
      frozenFields: true,
      canvas: canvas as unknown as HTMLCanvasElement,
    });

    expect(canvas.width).toBe(700);
    expect(canvas.height).toBe(1400);
    expect(ctx.scale).toHaveBeenCalledWith(0.35, 0.35);
    expect(ctx.drawImage).toHaveBeenCalledWith(previewImg, 0, 0, 2000, 4000);
    expect(ctx.save.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(ctx.restore.mock.calls.length).toBe(ctx.save.mock.calls.length);
  });

  it('restores canvas transform even if text rendering fails', async () => {
    const { canvas, ctx } = createMockCanvas();
    ctx.fillText.mockImplementationOnce(() => {
      throw new Error('font render boom');
    });
    const previewImg = { naturalWidth: 700, naturalHeight: 1400, width: 700, height: 1400 } as HTMLImageElement;

    await expect(
      drawCertificateToCanvas({
        templateImage: previewImg,
        logicalWidth: 2000,
        logicalHeight: 4000,
        targetWidth: 700,
        targetHeight: 1400,
        boxes: [SAMPLE_BOX],
        row: { Name: 'Ada Lovelace' },
        frozenFields: true,
        canvas: canvas as unknown as HTMLCanvasElement,
      })
    ).rejects.toThrow('font render boom');

    expect(ctx.restore).toHaveBeenCalled();
  });

  it('caps longest edge at 1400px (portrait 2000x4000 -> 700x1400) and encodes WebP', async () => {
    const { canvas, ctx, toBlob } = createMockCanvas();
    globalThis.document = {
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    const fullPortrait = { naturalWidth: 2000, naturalHeight: 4000, width: 2000, height: 4000 } as HTMLImageElement;
    const result = await renderCertificatePreviewBlob(
      {
        templateImage: fullPortrait,
        boxes: [SAMPLE_BOX],
        row: { Name: 'Ada Lovelace' },
        frozenFields: true,
      },
      1400
    );

    expect(result.width).toBe(700);
    expect(result.height).toBe(1400);
    expect(ctx.scale).toHaveBeenCalledWith(0.35, 0.35);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
    expect(result.blob.type).toBe('image/webp');
  });

  it('falls back to PNG if WebP canvas encoding is unsupported', async () => {
    const { canvas, toBlob } = createMockCanvas();
    toBlob.mockImplementation((cb: (blob: Blob | null) => void, mime: string) => {
      if (mime === 'image/webp') cb(null);
      else cb(new Blob(['png'], { type: mime }));
    });
    globalThis.document = {
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    const landscape = { naturalWidth: 2800, naturalHeight: 1400, width: 2800, height: 1400 } as HTMLImageElement;
    const result = await renderCertificatePreviewBlob(
      {
        templateImage: landscape,
        boxes: [SAMPLE_BOX],
        row: { Name: 'Grace Hopper' },
        frozenFields: true,
      },
      1400
    );

    expect(result.width).toBe(1400);
    expect(result.height).toBe(700);
    expect(result.blob.type).toBe('image/png');
  });

  it('supersamples low-resolution templates for crisp export and keeps high-res templates at 1x', () => {
    expect(computeExportScale(842, 595)).toBe(3);
    expect(computeExportScale(1920, 1080)).toBe(2);
    expect(computeExportScale(2000, 1414)).toBe(2);
    expect(computeExportScale(3508, 2480)).toBe(1);
  });

  it('exports supersampled 3x JPG/PDF for 842x595 templates and embeds lossless PNG in PDF when compact', async () => {
    const { canvas, ctx, toBlob } = createMockCanvas();
    // Minimal 1x1 valid PNG bytes so jsPDF addImage parses dimensions cleanly
    const tinyPngBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    toBlob.mockImplementation((cb: (blob: Blob | null) => void, mime: string) => {
      cb(new Blob([mime === 'image/png' ? tinyPngBytes : 'jpg-bytes'], { type: mime }));
    });
    globalThis.document = {
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    const a4Template = { naturalWidth: 842, naturalHeight: 595, width: 842, height: 595 } as HTMLImageElement;
    const out = await generateCertificate({
      templateImage: a4Template,
      boxes: [SAMPLE_BOX],
      row: { Name: 'Ada Lovelace' },
      filename: 'ada',
      includeJpg: true,
      includePdf: true,
    });

    // Backing buffer is 3x (2526x1785), while logical PDF page size remains 842x595.
    expect(canvas.width).toBe(842 * 3);
    expect(canvas.height).toBe(595 * 3);
    expect(ctx.scale).toHaveBeenCalledWith(3, 3);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', EXPORT_JPEG_QUALITY);
    expect(out.jpgBlob).toBeDefined();
    expect(out.pdfBlob).toBeDefined();
    const pdfText = await out.pdfBlob!.text();
    expect(pdfText).toContain('/MediaBox [0 0 1122.');
    expect(pdfText).toContain('/FlateDecode');
    expect(pdfText).not.toContain('/DCTDecode');
  });

  it('falls back to high-quality JPEG inside PDF when PNG exceeds PDF_MAX_PNG_BYTES', async () => {
    const { canvas, toBlob } = createMockCanvas();
    const oversizedPng = new Uint8Array(PDF_MAX_PNG_BYTES + 10);
    // Minimal JPEG SOF0 header bytes for jsPDF JPEG parser
    const tinyJpegBytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
      0x00, 0xff, 0xd9,
    ]);
    toBlob.mockImplementation((cb: (blob: Blob | null) => void, mime: string) => {
      cb(new Blob([mime === 'image/png' ? oversizedPng : tinyJpegBytes], { type: mime }));
    });
    globalThis.document = {
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    const largeTemplate = { naturalWidth: 2400, naturalHeight: 1600, width: 2400, height: 1600 } as HTMLImageElement;
    const out = await generateCertificate({
      templateImage: largeTemplate,
      boxes: [SAMPLE_BOX],
      row: { Name: 'Grace Hopper' },
      filename: 'grace',
      includePdf: true,
    });

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', EXPORT_JPEG_QUALITY);
    const pdfText = await out.pdfBlob!.text();
    expect(pdfText).toContain('/DCTDecode');
  });
});
