import { expect, it, vi } from 'vitest';
import { clearTextMeasurements, defaultCertificateFontSize, drawCertificateText, inspectCertificateText } from './certificate-text';
import { getPreviewBackingSize } from '../components/canvas/canvas-geometry';
import type { TextBox } from '../types';

it('scales new text sizes with artwork dimensions', () => {
  expect(defaultCertificateFontSize(400, 300)).toBe(18);
  expect(defaultCertificateFontSize(1200, 900)).toBe(54);
  expect(defaultCertificateFontSize(4000, 3000)).toBe(180);
  expect(defaultCertificateFontSize(5, 5)).toBe(1);
});

it('keeps preview buffers stable on fractional DPI and bounded when zoomed', () => {
  expect(getPreviewBackingSize(934, 700.5, 1.25)).toEqual({ width: 1167, height: 875 });
  const { width, height } = getPreviewBackingSize(16000, 12000, 2);
  expect(width * height).toBeLessThanOrEqual(8_000_000);
  expect(width).toBeLessThanOrEqual(4096);
  expect(width / height).toBeCloseTo(4 / 3, 2);
});

it('fits long text, reuses metrics, and recalculates when fonts load', () => {
  const mock = {
    font: '',
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: parseFloat(mock.font) * text.length })),
    fillText: vi.fn(),
  };
  const context = mock as unknown as CanvasRenderingContext2D;
  const box: TextBox = {
    id: 'name', field: 'Name', x: 0, y: 0, w: 36, h: 12, fontSize: 40,
    hAlign: 'center', vAlign: 'middle', fontColor: '#000', fontFamily: 'sans-serif',
  };
  const text = 'A long name';
  drawCertificateText(context, text, box, 'sans-serif');
  expect(mock.fillText).toHaveBeenCalledWith(text, 18, expect.any(Number), 27);
  expect(parseFloat(mock.font) * text.length).toBeLessThanOrEqual(27);
  mock.measureText.mockClear();
  drawCertificateText(context, text, box, 'sans-serif');
  expect(mock.measureText).not.toHaveBeenCalled();
  clearTextMeasurements(context);
  drawCertificateText(context, text, box, 'sans-serif');
  expect(mock.measureText).toHaveBeenCalled();
});

it('shares text sizing with the renderer and detects ink past the artwork', () => {
  const mock = {
    font: '', save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
    measureText: (text: string) => {
      const size = parseFloat(mock.font);
      const width = size * text.length;
      return { width, actualBoundingBoxLeft: width / 2, actualBoundingBoxRight: width / 2,
        actualBoundingBoxAscent: size, actualBoundingBoxDescent: size / 5 };
    },
  };
  const context = mock as unknown as CanvasRenderingContext2D;
  const box: TextBox = {
    id: 'name', field: 'Name', x: 10, y: 10, w: 100, h: 50, fontSize: 20,
    hAlign: 'center', vAlign: 'middle', fontColor: '#000', fontFamily: 'Test Family',
  };
  const text = 'A very long recipient';
  const fitted = inspectCertificateText(context, text, box, '"Test Family"', 1000, 1000);
  expect(fitted.status).toBe('tight');
  expect(fitted.size).toBeLessThan(box.fontSize);
  drawCertificateText(context, text, box, '"Test Family"');
  expect(parseFloat(mock.font)).toBe(fitted.size);
  expect(inspectCertificateText(context, 'Ada', { ...box, x: 970 }, '"Test Family"', 1000, 1000).status).toBe('overflow');
});

it('restores canvas context even on draw errors and safely ignores degenerate bounds', () => {
  let shouldThrow = true;
  const mock = {
    font: '',
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: (parseFloat(mock.font) || 10) * text.length })),
    fillText: vi.fn(() => {
      if (shouldThrow) throw new Error('canvas write failed');
    }),
  };
  const context = mock as unknown as CanvasRenderingContext2D;
  const zeroBox: TextBox = {
    id: 'z', field: 'Name', x: 0, y: 0, w: 0, h: 20, fontSize: 16,
    hAlign: 'center', vAlign: 'middle', fontColor: '#000', fontFamily: 'Inter',
  };
  drawCertificateText(context, 'Ada', zeroBox, 'Inter');
  expect(mock.fillText).not.toHaveBeenCalled();

  const validBox: TextBox = { ...zeroBox, w: 200, h: 50 };
  expect(() => drawCertificateText(context, 'Ada', validBox, 'Inter')).toThrow('canvas write failed');
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(mock.restore).toHaveBeenCalledTimes(1);

  shouldThrow = false;
  // LRU cache pressure test (> 1024 unique entries should stay responsive and bounded)
  for (let i = 0; i < 1200; i++) {
    drawCertificateText(context, `Participant ${i}`, validBox, 'Inter');
  }
  expect(mock.save.mock.calls.length).toBe(mock.restore.mock.calls.length);
});
