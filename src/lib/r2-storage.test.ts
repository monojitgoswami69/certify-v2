import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPresignedMailStagingUpload,
  createPresignedTemplateUpload,
  createSignedR2ObjectUrl,
  isAllowedMailStagingKey,
  isAllowedR2TemplateUrl,
  isR2Configured,
  verifyR2Artwork,
} from './r2-storage';
import { readIssuedDesign } from './event-design-validation';

const KEYS = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

const savedEnv: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of KEYS) savedEnv[key] = process.env[key];
  process.env.R2_ACCOUNT_ID = 'acc1234567890';
  process.env.R2_BUCKET = 'wecertify';
  process.env.R2_PUBLIC_BASE_URL = 'https://assets.wecertify.tech';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('r2-storage presigned URLs and validation', () => {
  it('generates SigV4 presigned PUT URLs targeting R2 and matching allowed public URL format', () => {
    expect(isR2Configured()).toBe(true);

    const full = createPresignedTemplateUpload({
      userId: 'test-user',
      contentType: 'image/png',
      contentLength: 1024,
      kind: 'full',
      now: new Date('2026-11-26T12:00:00Z'),
    });
    const uploadParsed = new URL(full.uploadUrl);
    expect(uploadParsed.hostname).toBe('acc1234567890.r2.cloudflarestorage.com');
    expect(uploadParsed.pathname).toMatch(/^\/wecertify\/designs\/[0-9a-f]{24}\/[0-9a-f]{32}\.png$/);
    expect(uploadParsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(uploadParsed.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(uploadParsed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host;if-none-match');
    expect(uploadParsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(isAllowedR2TemplateUrl(full.publicUrl, 'full')).toBe(true);
    expect(isAllowedR2TemplateUrl(full.publicUrl, 'preview')).toBe(false);

    const preview = createPresignedTemplateUpload({ userId: 'test-user', contentType: 'image/webp', contentLength: 512, kind: 'preview' });
    expect(isAllowedR2TemplateUrl(preview.publicUrl, 'preview')).toBe(true);
    expect(isAllowedR2TemplateUrl(preview.publicUrl, 'full')).toBe(false);
  });

  it('checks storage ownership before requesting artwork and validates the stored bytes', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = createPresignedTemplateUpload({ userId: 'alice', contentType: 'image/png', contentLength: bytes.length });
    const get = vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', get);
    await expect(verifyR2Artwork(upload.publicUrl, 'bob', 'full', 1, 1)).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
    await expect(verifyR2Artwork(upload.publicUrl, 'alice', 'full', 2, 1)).resolves.toBeNull();
    await expect(verifyR2Artwork(upload.publicUrl, 'alice', 'full', 1, 1)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-R2 origins, query strings, traversal, or forged URLs in readIssuedDesign', () => {
    const full = createPresignedTemplateUpload({ userId: 'test-user', contentType: 'image/png', contentLength: 1024, kind: 'full' });
    const preview = createPresignedTemplateUpload({ userId: 'test-user', contentType: 'image/webp', contentLength: 512, kind: 'preview' });

    const valid = readIssuedDesign({
      imageData: full.publicUrl,
      previewImageData: preview.publicUrl,
      previewWidth: 1400,
      previewHeight: 990,
      width: 3508,
      height: 2480,
      layoutConfig: { boxes: [] },
    });
    expect(valid).toMatchObject({ imageData: full.publicUrl, previewImageData: preview.publicUrl });

    expect(isAllowedR2TemplateUrl('https://evil.example/designs/a/b.png', 'full')).toBe(false);
    expect(isAllowedR2TemplateUrl(`${full.publicUrl}?foo=1`, 'full')).toBe(false);
    expect(isAllowedR2TemplateUrl('https://assets.wecertify.tech/other/file.png', 'full')).toBe(false);

    expect(
      readIssuedDesign({
        imageData: 'https://evil.example/malware.png',
        width: 3508,
        height: 2480,
        layoutConfig: { boxes: [] },
      })
    ).toBeNull();
  });

  it('scopes staged mail keys strictly to their creator and signs GET/DELETE URLs', () => {
    const staged = createPresignedMailStagingUpload({
      userId: 'user-alice',
      contentLength: 4_500_000,
    });
    expect(staged.key).toMatch(/^mail-staging\/v2\/[0-9a-f]{24}\/[0-9a-f]{32}\.bin$/);
    expect(isAllowedMailStagingKey(staged.key, 'user-alice')).toBe(true);
    expect(isAllowedMailStagingKey(staged.key, 'user-bob')).toBe(false);
    expect(isAllowedMailStagingKey('../secret.bin', 'user-alice')).toBe(false);

    const parsedPut = new URL(staged.uploadUrl);
    expect(parsedPut.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');

    const getUrl = new URL(createSignedR2ObjectUrl('GET', staged.key));
    expect(getUrl.pathname).toBe(`/wecertify/${staged.key}`);
    expect(getUrl.searchParams.get('X-Amz-SignedHeaders')).toBe('host');

    const delUrl = new URL(createSignedR2ObjectUrl('DELETE', staged.key));
    expect(delUrl.pathname).toBe(`/wecertify/${staged.key}`);
  });
});
