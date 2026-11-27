import { createCanvas } from '@napi-rs/canvas';
import { inflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { buildCertificatePdfFromCanvas } from './pdf-writer.js';

function readFlateObject(pdf: Buffer, number: number) {
  const object = pdf.indexOf(`\n${number} 0 obj\n`);
  const stream = pdf.indexOf('\nstream\n', object);
  const dictionary = pdf.subarray(object, stream).toString('latin1');
  const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1]);
  const start = stream + '\nstream\n'.length;
  return inflateSync(pdf.subarray(start, start + length));
}

it('embeds the exact canvas colors and a transparency mask at Studio page size', async () => {
  const canvas = createCanvas(3, 1);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#183664';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = 'rgba(230, 77, 31, 0.6)';
  ctx.fillRect(1, 0, 1, 1);
  const expected = ctx.getImageData(0, 0, 3, 1).data;
  const pdf = await buildCertificatePdfFromCanvas({
    canvas, targetWidth: 3, targetHeight: 1, naturalWidth: 3, naturalHeight: 1, pngBytes: 1,
  });
  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 4 1.3333]');
  expect(pdf.toString('latin1')).toContain('/SMask 6 0 R');
  expect([...readFlateObject(pdf, 4)]).toEqual([...expected].filter((_, i) => i % 4 !== 3));
  expect([...readFlateObject(pdf, 6)]).toEqual([expected[3], expected[7], expected[11]]);
});
