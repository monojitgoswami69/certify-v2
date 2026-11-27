import { createCanvas, loadImage } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { describe, expect, it, vi } from 'vitest';
import type { IssuedEventDesign } from '../../src/lib/event-design.js';
import { createWorkerLogger, currentRssMb } from './logger.js';
import { WorkerRenderContext } from './renderer.js';

async function makeSolidTemplateDataUrl(width: number, height: number): Promise<string> {
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FBFAF5';
  ctx.fillRect(0, 0, width, height);
  // Subtle border to mimic certificate template
  ctx.strokeStyle = '#E2DDD5';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.005));
  ctx.strokeRect(20, 20, width - 40, height - 40);
  const png = await c.encode('png');
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function countInkPixelsInRegion(
  pngBuffer: Buffer,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<number> {
  const img = await loadImage(pngBuffer);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h)).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Non-cream / inked pixel check
    if (data[i] < 160 && data[i + 1] < 160 && data[i + 2] < 160) dark++;
  }
  return dark;
}

describe('worker Skia certificate renderer fidelity & 512 MB memory budget', () => {
  const logger = createWorkerLogger('render-test', () => {});

  it('rejects an unapproved template origin and oversized artwork before decoding', async () => {
    const fetchArtwork = vi.fn<typeof fetch>();
    const design: IssuedEventDesign = {
      imageData: 'https://unapproved.example.test/template.png',
      width: 4000,
      height: 4500,
      layoutConfig: { boxes: [] },
    };
    await expect(WorkerRenderContext.create(design, logger, fetchArtwork)).rejects.toThrow('configured R2 origin');
    expect(fetchArtwork).not.toHaveBeenCalled();

    const header = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(header);
    header.writeUInt32BE(design.width, 16);
    header.writeUInt32BE(design.height, 20);
    await expect(WorkerRenderContext.create({
      ...design, imageData: `data:image/png;base64,${header.toString('base64')}`,
    }, logger)).rejects.toThrow('background rendering pixel budget');
  });

  it('supersamples 400x300 templates, renders aligned typography, and produces decodable QRs + PDF', async () => {
    const certId = '550e8400-e29b-41d4-a716-446655440000';
    const dataUrl = await makeSolidTemplateDataUrl(400, 300);
    const design: IssuedEventDesign = {
      imageData: dataUrl,
      width: 400,
      height: 300,
      verificationOrigin: 'https://wecertify.tech',
      layoutConfig: {
        boxes: [
          {
            id: 'name-box',
            x: 60,
            y: 110,
            w: 280,
            h: 48,
            field: 'Name',
            fontSize: 28,
            fontColor: '#111827',
            fontFamily: 'serif',
            hAlign: 'center',
            vAlign: 'middle',
          },
          {
            id: 'static-label',
            x: 60,
            y: 60,
            w: 200,
            h: 28,
            field: '',
            kind: 'static',
            staticText: 'CERTIFICATE OF HONOR',
            fontSize: 14,
            fontColor: '#111827',
            fontFamily: 'sans-serif',
            hAlign: 'left',
            vAlign: 'top',
          },
        ],
        qrZones: [{ id: 'qr1', x: 290, y: 190, size: 80 }],
      },
    };

    const t0 = performance.now();
    const ctx = await WorkerRenderContext.create(design, logger);
    const rendered = await ctx.render({
      certificateId: certId,
      recipientName: 'Alice Smith',
      renderFields: { Name: 'Alice Smith' },
      formats: { attachPdf: true, attachPng: true },
    });
    const renderMs = Math.round(performance.now() - t0);
    ctx.dispose();

    expect(rendered.pngBuffer).toBeDefined();
    expect(rendered.pdfBuffer).toBeDefined();
    const pdfAscii = rendered.pdfBuffer!.toString('latin1');
    expect(rendered.pdfBuffer!.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfAscii).toContain('/MediaBox [0 0 533.3333 400]');
    expect(pdfAscii.trimEnd().endsWith('%%EOF')).toBe(true);

    const img = await loadImage(rendered.pngBuffer!);
    // Matches computeExportScale(400, 300) = 3x -> 1200x900
    expect(img.width).toBe(1200);
    expect(img.height).toBe(900);

    // Check inked text pixels exist in the centered Name box at 3x scale
    const textInk = await countInkPixelsInRegion(rendered.pngBuffer!, 180, 330, 840, 144);
    expect(textInk).toBeGreaterThan(250);

    // Check QR decodes from the 3x rendered PNG canvas cleanly
    const checkCanvas = createCanvas(300, 300);
    const checkCtx = checkCanvas.getContext('2d');
    checkCtx.fillStyle = '#FFFFFF';
    checkCtx.fillRect(0, 0, 300, 300);
    checkCtx.drawImage(img, 290 * 3, 190 * 3, 80 * 3, 80 * 3, 30, 30, 240, 240);
    const qrPixels = checkCtx.getImageData(0, 0, 300, 300);
    const decoded = jsQR(qrPixels.data, 300, 300);
    expect(decoded?.data).toBe(`https://wecertify.tech/verify/${certId}`);

    console.log(`[bench:400x300] renderMs=${renderMs}ms pngKB=${Math.round(rendered.pngBuffer!.byteLength / 1024)} pdfKB=${Math.round(rendered.pdfBuffer!.byteLength / 1024)} rssMB=${currentRssMb()}`);
  });

  it('renders high-resolution 4000x3000 artwork cleanly within the 512 MB dyno budget', async () => {
    const certId = '660e8400-e29b-41d4-a716-446655440001';
    const dataUrl = await makeSolidTemplateDataUrl(4000, 3000);
    const design: IssuedEventDesign = {
      imageData: dataUrl,
      width: 4000,
      height: 3000,
      verificationOrigin: 'https://wecertify.tech',
      layoutConfig: {
        boxes: [
          {
            id: 'name-box',
            x: 800,
            y: 1300,
            w: 2400,
            h: 320,
            field: 'Name',
            fontSize: 180,
            fontColor: '#111827',
            fontFamily: 'serif',
            hAlign: 'center',
            vAlign: 'middle',
          },
        ],
        qrZones: [{ id: 'qr1', x: 3200, y: 2200, size: 500 }],
      },
    };

    const t0 = performance.now();
    const ctx = await WorkerRenderContext.create(design, logger);
    const rendered = await ctx.render({
      certificateId: certId,
      recipientName: 'Bob Patel',
      renderFields: { Name: 'Bob Patel' },
      formats: { attachPdf: true, attachPng: true },
    });
    const renderMs = Math.round(performance.now() - t0);
    ctx.dispose();

    const img = await loadImage(rendered.pngBuffer!);
    expect(img.width).toBe(4000);
    expect(img.height).toBe(3000);

    // Decode QR directly from 4000x3000 image
    const qrCanvas = createCanvas(600, 600);
    const qrCtx = qrCanvas.getContext('2d');
    qrCtx.fillStyle = '#FFFFFF';
    qrCtx.fillRect(0, 0, 600, 600);
    qrCtx.drawImage(img, 3200, 2200, 500, 500, 50, 50, 500, 500);
    const decoded = jsQR(qrCtx.getImageData(0, 0, 600, 600).data, 600, 600);
    expect(decoded?.data).toBe(`https://wecertify.tech/verify/${certId}`);

    const peakRss = currentRssMb();
    const heapMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
    expect(heapMb).toBeLessThan(260);
    console.log(`[bench:4000x3000] renderMs=${renderMs}ms pngKB=${Math.round(rendered.pngBuffer!.byteLength / 1024)} pdfKB=${Math.round(rendered.pdfBuffer!.byteLength / 1024)} heapMB=${heapMb} vitestRssMB=${peakRss}`);
  });
});
