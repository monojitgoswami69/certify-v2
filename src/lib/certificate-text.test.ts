import { expect, it, vi } from 'vitest';
import { clearTextMeasurements, defaultCertificateFontSize, drawCertificateText } from './certificate-text';
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
