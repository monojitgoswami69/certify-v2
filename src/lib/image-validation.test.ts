import { describe, it, expect } from 'vitest';
import { parseImageDataUrl } from './image-validation';

// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Minimal JPEG: FF D8 FF header
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP/wAARCAAB';

describe('parseImageDataUrl', () => {
  it('accepts a real PNG (magic bytes verified)', () => {
    const result = parseImageDataUrl(`data:image/png;base64,${TINY_PNG_BASE64}`);
    expect(result).not.toBeNull();
    expect(result?.mime).toBe('png');
    expect(result?.bytes.length).toBeGreaterThan(8);
  });

  it('accepts a JPEG data URL declared as jpg', () => {
    const result = parseImageDataUrl(`data:image/jpg;base64,${TINY_JPEG_BASE64}`);
    expect(result?.mime).toBe('jpeg');
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
});
