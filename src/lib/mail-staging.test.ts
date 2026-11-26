import { describe, expect, it } from 'vitest';
import { packMailAttachments, unpackMailAttachments } from './mail-staging';

describe('mail-staging binary envelope', () => {
  it('round-trips PDF and PNG blobs cleanly without altering bytes', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);
    const pdfBytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52, 99]);

    const packed = await packMailAttachments([
      { slot: 'png', blob: new Blob([pngBytes], { type: 'image/png' }) },
      { slot: 'pdf', blob: new Blob([pdfBytes], { type: 'application/pdf' }) },
    ]);

    const unpacked = unpackMailAttachments(new Uint8Array(await packed.arrayBuffer()));
    expect(unpacked).toHaveLength(2);
    expect(unpacked[0].slot).toBe('png');
    expect(Uint8Array.from(unpacked[0].data)).toEqual(pngBytes);
    expect(unpacked[1].slot).toBe('pdf');
    expect(Uint8Array.from(unpacked[1].data)).toEqual(pdfBytes);
  });

  it('rejects truncated or tampered staged buffers', async () => {
    const packed = await packMailAttachments([
      { slot: 'pdf', blob: new Blob([Uint8Array.from([1, 2, 3, 4])]) },
    ]);
    const raw = new Uint8Array(await packed.arrayBuffer());
    expect(() => unpackMailAttachments(raw.subarray(0, raw.length - 1))).toThrow();
    expect(() => unpackMailAttachments(new Uint8Array([0, 0, 0, 99, 123, 125]))).toThrow();
  });
});
