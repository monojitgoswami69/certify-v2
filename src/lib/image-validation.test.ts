import { describe, it, expect } from 'vitest';
import {
  extractImageDimensions,
  isWithinImagePixelBudget,
  MAX_IMAGE_EDGE,
  MAX_INLINE_TEMPLATE_BYTES,
  parseImageDataUrl,
} from './image-validation';
import { readIssuedDesign } from './event-design-validation';

// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Minimal JPEG: FF D8 FF header
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP/wAARCAAB';

function makePngWithDimensions(width: number, height: number): string {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
}

function makeJpegWithDimensions(width: number, height: number, marker = 0xc0): Uint8Array {
  const buf = new Uint8Array(15);
  const view = new DataView(buf.buffer);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; // SOI + marker prefix
  buf[3] = marker;
  view.setUint16(4, 11, false); // SOF segment length
  buf[6] = 8;
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  return buf;
}

function makeWebpVp8x(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  buf.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  buf[24] = wMinus1 & 0xff;
  buf[25] = (wMinus1 >> 8) & 0xff;
  buf[26] = (wMinus1 >> 16) & 0xff;
  buf[27] = hMinus1 & 0xff;
  buf[28] = (hMinus1 >> 8) & 0xff;
  buf[29] = (hMinus1 >> 16) & 0xff;
  return buf;
}

describe('parseImageDataUrl & dimension limits', () => {
  it('accepts a real PNG (magic bytes verified)', () => {
    const result = parseImageDataUrl(`data:image/png;base64,${TINY_PNG_BASE64}`);
    expect(result).not.toBeNull();
    expect(result?.mime).toBe('png');
    expect(result?.bytes.length).toBeGreaterThan(8);
    expect(result?.dimensions).toEqual({ width: 1, height: 1 });
  });

  it('accepts a JPEG data URL declared as jpg', () => {
    const result = parseImageDataUrl(`data:image/jpg;base64,${TINY_JPEG_BASE64}`);
    expect(result?.mime).toBe('jpeg');
  });

  it('extracts PNG, JPEG SOF0/SOF2, and WebP VP8X/VP8L/VP8 dimensions', () => {
    const jpeg = makeJpegWithDimensions(2400, 1600, 0xc2);
    expect(extractImageDimensions(jpeg, 'jpeg')).toEqual({ width: 2400, height: 1600 });

    const webpVp8x = makeWebpVp8x(3840, 2160);
    expect(extractImageDimensions(webpVp8x, 'webp')).toEqual({ width: 3840, height: 2160 });

    const webpVp8l = new Uint8Array(25);
    webpVp8l.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 0);
    webpVp8l[20] = 0x2f;
    const packed = ((1200 - 1) & 0x3fff) | (((900 - 1) & 0x3fff) << 14);
    new DataView(webpVp8l.buffer).setUint32(21, packed, true);
    expect(extractImageDimensions(webpVp8l, 'webp')).toEqual({ width: 1200, height: 900 });

    const webpVp8 = new Uint8Array(30);
    webpVp8.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 0);
    webpVp8.set([0x9d, 0x01, 0x2a], 23);
    new DataView(webpVp8.buffer).setUint16(26, 1920, true);
    new DataView(webpVp8.buffer).setUint16(28, 1080, true);
    expect(extractImageDimensions(webpVp8, 'webp')).toEqual({ width: 1920, height: 1080 });
  });

  it('rejects decompression-bomb image dimensions exceeding edge or pixel budget', () => {
    expect(isWithinImagePixelBudget(12000, 4000)).toBe(true);
    expect(isWithinImagePixelBudget(12001, 1)).toBe(false);
    expect(isWithinImagePixelBudget(8000, 8000)).toBe(false);
    expect(isWithinImagePixelBudget(0, 100)).toBe(false);

    expect(parseImageDataUrl(makePngWithDimensions(MAX_IMAGE_EDGE + 1, 100))).toBeNull();
    expect(parseImageDataUrl(makePngWithDimensions(8000, 8000))).toBeNull();
    expect(parseImageDataUrl(makePngWithDimensions(3508, 2480))?.dimensions).toEqual({
      width: 3508,
      height: 2480,
    });

    // EXIF-rotated portrait vs sensor landscape axes must be accepted, while forged dims must fail
    const landscapePng = makePngWithDimensions(2400, 1600);
    expect(
      readIssuedDesign({ imageData: landscapePng, width: 1600, height: 2400, layoutConfig: { boxes: [] } })
    ).not.toBeNull();
    expect(
      readIssuedDesign({ imageData: landscapePng, width: 100, height: 100, layoutConfig: { boxes: [] } })
    ).toBeNull();
  });

  it('rejects a valid base64 payload whose magic bytes are not an image', () => {
    // "not a png" — decodes to plain ASCII
    const fake = Buffer.from('this is definitely not an image').toString('base64');
    expect(parseImageDataUrl(`data:image/png;base64,${fake}`)).toBeNull();
  });

  it('rejects non-data-url strings and wrong mimetypes', () => {
    expect(parseImageDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseImageDataUrl('data:image/gif;base64,R0lGODlh')).toBeNull();
    expect(parseImageDataUrl('')).toBeNull();
    expect(parseImageDataUrl(null)).toBeNull();
    expect(parseImageDataUrl(42)).toBeNull();
  });

  it('rejects empty payloads', () => {
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
  });

  it('validates optional previewImageData dimensions, aspect ratio, and size bounds in readIssuedDesign', () => {
    const fullPortrait = makePngWithDimensions(2000, 4000);
    const previewWebpDataUrl = `data:image/webp;base64,${Buffer.from(makeWebpVp8x(700, 1400)).toString('base64')}`;

    const valid = readIssuedDesign({
      imageData: fullPortrait,
      previewImageData: previewWebpDataUrl,
      previewWidth: 700,
      previewHeight: 1400,
      width: 2000,
      height: 4000,
      layoutConfig: { boxes: [] },
    });
    expect(valid).toMatchObject({
      width: 2000,
      height: 4000,
      previewWidth: 700,
      previewHeight: 1400,
      previewImageData: previewWebpDataUrl,
    });

    // Rejects partial preview fields
    expect(
      readIssuedDesign({
        imageData: fullPortrait,
        previewWidth: 700,
        previewHeight: 1400,
        width: 2000,
        height: 4000,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();

    // Rejects preview exceeding 1400px longest edge
    const oversizedPreview = `data:image/webp;base64,${Buffer.from(makeWebpVp8x(1000, 2000)).toString('base64')}`;
    expect(
      readIssuedDesign({
        imageData: fullPortrait,
        previewImageData: oversizedPreview,
        previewWidth: 1000,
        previewHeight: 2000,
        width: 2000,
        height: 4000,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();

    // Rejects disproportionate aspect ratio
    const squarePreview = `data:image/webp;base64,${Buffer.from(makeWebpVp8x(1000, 1000)).toString('base64')}`;
    expect(
      readIssuedDesign({
        imageData: fullPortrait,
        previewImageData: squarePreview,
        previewWidth: 1000,
        previewHeight: 1000,
        width: 2000,
        height: 4000,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();

    // Rejects declared dimensions mismatching payload bytes
    expect(
      readIssuedDesign({
        imageData: fullPortrait,
        previewImageData: previewWebpDataUrl,
        previewWidth: 500,
        previewHeight: 1000,
        width: 2000,
        height: 4000,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();
  });

  it('rejects inline base64 templates exceeding the 3 MB inline byte cap in readIssuedDesign', () => {
    const oversizedBuf = new Uint8Array(MAX_INLINE_TEMPLATE_BYTES + 16);
    oversizedBuf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(oversizedBuf.buffer);
    view.setUint32(8, 13, false);
    oversizedBuf.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, 2000, false);
    view.setUint32(20, 1414, false);
    const oversizedUrl = `data:image/png;base64,${Buffer.from(oversizedBuf).toString('base64')}`;

    expect(
      readIssuedDesign({
        imageData: oversizedUrl,
        width: 2000,
        height: 1414,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();
  });
});
