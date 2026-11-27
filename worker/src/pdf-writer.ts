import type { Canvas } from '@napi-rs/canvas';
import { pipeline, Readable } from 'node:stream';
import { createDeflate } from 'node:zlib';
import { EXPORT_JPEG_QUALITY, PDF_MAX_PNG_BYTES } from '../../src/lib/export-scale.js';
import { MAX_MAIL_ATTACHMENT_BYTES } from '../../src/lib/mail-staging.js';
import { MailSizeError } from './mail-file.js';

function assemblePdfDocument(params: {
  ptWidth: number;
  ptHeight: number;
  imgWidth: number;
  imgHeight: number;
  imageStream: Buffer;
  filter: '/DCTDecode' | '/FlateDecode';
  alpha?: Buffer;
}): Buffer {
  const { ptWidth, ptHeight, imgWidth, imgHeight, imageStream, filter, alpha } = params;
  const contentStream = Buffer.from(`q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im0 Do Q\n`, 'latin1');
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let byteOffset = 0;

  const push = (part: Buffer | string) => {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part, 'latin1');
    chunks.push(buf);
    byteOffset += buf.byteLength;
  };

  const writeObject = (num: number, dict: string, stream?: Buffer) => {
    offsets[num] = byteOffset;
    push(`${num} 0 obj\n${dict}`);
    if (stream) {
      push('\nstream\n');
      push(stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  };

  push(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  writeObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  writeObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  writeObject(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  const imageProperties = `/Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /BitsPerComponent 8`;
  writeObject(4, `<< ${imageProperties} /ColorSpace /DeviceRGB /Filter ${filter} /Length ${imageStream.byteLength}${alpha ? ' /SMask 6 0 R' : ''} >>`, imageStream);
  writeObject(5, `<< /Length ${contentStream.byteLength} >>`, contentStream);
  if (alpha) {
    writeObject(6, `<< ${imageProperties} /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${alpha.byteLength} >>`, alpha);
  }

  const xrefOffset = byteOffset;
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) {
    push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks, byteOffset);
}

function* pixelRows(rgba: Buffer, width: number, alphaOnly: boolean) {
  const rowBytes = width * 4;
  for (let row = 0; row < rgba.length; row += rowBytes) {
    const out = Buffer.allocUnsafe(width * (alphaOnly ? 1 : 3));
    for (let i = row, j = 0; i < row + rowBytes; i += 4) {
      const alpha = rgba[i + 3];
      if (alphaOnly) {
        out[j++] = alpha;
      } else if (alpha === 255) {
        out[j++] = rgba[i];
        out[j++] = rgba[i + 1];
        out[j++] = rgba[i + 2];
      } else if (alpha === 0) {
        out[j++] = 0;
        out[j++] = 0;
        out[j++] = 0;
      } else {
        out[j++] = Math.round(rgba[i] * 255 / alpha);
        out[j++] = Math.round(rgba[i + 1] * 255 / alpha);
        out[j++] = Math.round(rgba[i + 2] * 255 / alpha);
      }
    }
    yield out;
  }
}

async function compressPixels(rgba: Buffer, width: number, alphaOnly: boolean, limit: number) {
  const rows = Readable.from(pixelRows(rgba, width, alphaOnly), { objectMode: false });
  const compressed = pipeline(rows, createDeflate(), () => {});
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of compressed) {
      bytes += chunk.length;
      if (bytes > limit) throw new MailSizeError('PDF attachment exceeds the available email size limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    rows.destroy();
    compressed.destroy();
  }
}

function hasTransparentPixels(rgba: Buffer) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return true;
  }
  return false;
}

/** Embed the raster with Studio's page geometry and PNG/JPEG selection. */
export async function buildCertificatePdfFromCanvas(params: {
  canvas: Canvas;
  targetWidth: number;
  targetHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  pngBytes: number;
  maxBytes?: number;
}): Promise<Buffer> {
  const { canvas, targetWidth, targetHeight, naturalWidth, naturalHeight, pngBytes } = params;
  const maxBytes = params.maxBytes ?? MAX_MAIL_ATTACHMENT_BYTES;
  const geometry = {
    ptWidth: Number((naturalWidth * (4 / 3)).toFixed(4)),
    ptHeight: Number((naturalHeight * (4 / 3)).toFixed(4)),
    imgWidth: targetWidth,
    imgHeight: targetHeight,
  };

  let imageStream: Buffer;
  let alpha: Buffer | undefined;
  const useLossless = pngBytes <= PDF_MAX_PNG_BYTES;
  if (useLossless) {
    // Borrow Skia's premultiplied RGBA surface while the caller holds exclusive
    // use of the canvas. Read one row at a time and preserve opacity in a mask.
    const rgba = canvas.data();
    imageStream = await compressPixels(rgba, targetWidth, false, maxBytes);
    if (hasTransparentPixels(rgba)) {
      alpha = await compressPixels(rgba, targetWidth, true, maxBytes - imageStream.length);
    }
  } else {
    imageStream = await canvas.encode('jpeg', Math.round(EXPORT_JPEG_QUALITY * 100));
  }
  if (imageStream.length > maxBytes) throw new MailSizeError('PDF attachment exceeds the available email size limit.');

  const pdf = assemblePdfDocument({
    ...geometry, imageStream, filter: useLossless ? '/FlateDecode' : '/DCTDecode', alpha,
  });
  if (pdf.length > maxBytes) throw new MailSizeError('PDF attachment exceeds the available email size limit.');
  return pdf;
}
