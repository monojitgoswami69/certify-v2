import crypto from 'node:crypto';
import { env } from './env';
import { boundedBody, BodyTooLarge } from './bounded-body';
import { extractImageDimensions, hasImageMagicBytes, isWithinImagePixelBudget, MAX_TEMPLATE_BYTES, type SupportedImageType } from './image-validation';

export type TemplateUploadMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/octet-stream';
export type TemplateUploadKind = 'full' | 'preview' | 'mail-staging';

const PRESIGN_EXPIRY_SECONDS = 120;
const EXTENSION_BY_MIME: Record<'image/png' | 'image/jpeg' | 'image/webp', string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hmacSha256(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function objectOwnerPrefix(userId: string): string {
  return sha256Hex(userId).slice(0, 24);
}

export function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_BUCKET &&
      env.R2_PUBLIC_BASE_URL &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY
  );
}

export function getR2PublicBaseUrl(): string | null {
  if (!env.R2_PUBLIC_BASE_URL) return null;
  return env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
}

export const MAX_R2_PREVIEW_BYTES = 2 * 1024 * 1024;
export const R2_CREATE_ONLY_HEADERS = { 'If-None-Match': '*' };
const R2_FULL_PATH_RE = /^\/designs\/(?:[0-9a-f-]{36}|[0-9a-f]{24})\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;
const R2_PREVIEW_PATH_RE = /^\/designs\/(?:[0-9a-f-]{36}|[0-9a-f]{24})\/[0-9a-f]{32}-preview\.webp$/;

/**
 * Verifies that a submitted external image URL strictly targets our configured
 * Cloudflare R2 public origin and uses our random capability path format.
 */
export function isAllowedR2TemplateUrl(
  value: unknown,
  kind?: 'full' | 'preview'
): boolean {
  return r2TemplateKey(value, kind) !== null;
}

export function extractR2TemplateKey(value: unknown, kind?: 'full' | 'preview'): string | null {
  return r2TemplateKey(value, kind);
}

function r2TemplateKey(value: unknown, kind?: 'full' | 'preview'): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  const baseUrl = getR2PublicBaseUrl();
  if (!baseUrl) return null;

  try {
    const parsed = new URL(value);
    const expectedBase = new URL(baseUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== expectedBase.origin ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    const basePrefix = expectedBase.pathname.replace(/\/+$/, '');
    if (basePrefix && !parsed.pathname.startsWith(`${basePrefix}/`)) return null;
    const relPath = basePrefix ? parsed.pathname.slice(basePrefix.length) : parsed.pathname;
    const matches = kind === 'preview' ? R2_PREVIEW_PATH_RE.test(relPath)
      : kind === 'full' ? R2_FULL_PATH_RE.test(relPath)
      : R2_FULL_PATH_RE.test(relPath) || R2_PREVIEW_PATH_RE.test(relPath);
    return matches && value === `${baseUrl}${relPath}` ? relPath.slice(1) : null;
  } catch {
    return null;
  }
}

/** Check actual bytes before a newly uploaded object can become an issued design. */
export async function verifyR2Artwork(
  value: string, userId: string, kind: 'full' | 'preview', width: number, height: number
): Promise<string | null> {
  const key = r2TemplateKey(value, kind);
  if (!key?.startsWith(`designs/${objectOwnerPrefix(userId)}/`)) return null;

  const extension = key.slice(key.lastIndexOf('.') + 1);
  const mime = (extension === 'jpg' ? 'jpeg' : extension) as SupportedImageType;
  const limit = kind === 'preview' ? MAX_R2_PREVIEW_BYTES : MAX_TEMPLATE_BYTES;
  try {
    const response = await fetch(createSignedR2ObjectUrl('GET', key), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not read uploaded artwork from R2');
    if (response.headers.get('content-type') !== `image/${mime}`) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = Buffer.from(await boundedBody(response, limit).arrayBuffer());
    if (!hasImageMagicBytes(bytes, mime)) return null;
    const dimensions = extractImageDimensions(bytes, mime);
    if (!dimensions || !isWithinImagePixelBudget(dimensions.width, dimensions.height)) return null;
    const exact = dimensions.width === width && dimensions.height === height;
    const rotatedJpeg = mime === 'jpeg' && dimensions.width === height && dimensions.height === width;
    if (!exact && !rotatedJpeg) return null;
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    if (error instanceof BodyTooLarge) return null;
    throw error;
  }
}

/**
 * Verifies a private R2 staged mail key belongs strictly to `userId`.
 */
export function isAllowedMailStagingKey(value: unknown, userId: string): value is string {
  if (typeof value !== 'string' || !userId) return false;
  const owner = objectOwnerPrefix(userId);
  return new RegExp(`^mail-staging/v2/${owner}/[0-9a-f]{32}\\.bin$`).test(value);
}

function signR2S3Request({
  method,
  key,
  signedExtraHeaders = {},
  expiresSeconds = PRESIGN_EXPIRY_SECONDS,
  now = new Date(),
}: {
  method: 'GET' | 'PUT' | 'DELETE';
  key: string;
  signedExtraHeaders?: Record<string, string>;
  expiresSeconds?: number;
  now?: Date;
}): string {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 storage is not configured');
  }

  const accountId = env.R2_ACCOUNT_ID!;
  const bucket = env.R2_BUCKET!;
  const accessKeyId = env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY!;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${rfc3986Encode(bucket)}/${key.split('/').map(rfc3986Encode).join('/')}`;

  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = iso.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const headers: Record<string, string> = { ...signedExtraHeaders, host };
  const sortedHeaderNames = Object.keys(headers).sort();
  const signedHeaders = sortedHeaderNames.join(';');
  const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', iso],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    iso,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, 'auto');
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createPresignedTemplateUpload({
  userId,
  contentType,
  contentLength,
  kind = 'full',
  now = new Date(),
}: {
  userId: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  contentLength: number;
  kind?: 'full' | 'preview';
  now?: Date;
}): {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  uploadHeaders: typeof R2_CREATE_ONLY_HEADERS;
} {
  if (!userId || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('Invalid contentLength for presigned R2 upload');
  }

  const publicBase = getR2PublicBaseUrl();
  if (!publicBase) {
    throw new Error('Cloudflare R2 storage is not configured');
  }

  const ext = EXTENSION_BY_MIME[contentType];
  const suffix = kind === 'preview' ? '-preview' : '';
  const key = `designs/${objectOwnerPrefix(userId)}/${crypto.randomBytes(16).toString('hex')}${suffix}.${ext}`;

  const uploadUrl = signR2S3Request({
    method: 'PUT',
    key,
    signedExtraHeaders: {
      'content-length': String(contentLength),
      'content-type': contentType,
      'if-none-match': R2_CREATE_ONLY_HEADERS['If-None-Match'],
    },
    now,
  });

  return {
    uploadUrl,
    publicUrl: `${publicBase}/${key}`,
    key,
    contentType,
    uploadHeaders: R2_CREATE_ONLY_HEADERS,
  };
}

export function createPresignedMailStagingUpload({
  userId,
  contentLength,
  now = new Date(),
}: {
  userId: string;
  contentLength: number;
  now?: Date;
}): {
  uploadUrl: string;
  key: string;
  contentType: 'application/octet-stream';
} {
  if (!userId || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('Invalid parameters for presigned mail staging upload');
  }

  const key = `mail-staging/v2/${objectOwnerPrefix(userId)}/${crypto.randomBytes(16).toString('hex')}.bin`;
  const uploadUrl = signR2S3Request({
    method: 'PUT',
    key,
    signedExtraHeaders: {
      'content-length': String(contentLength),
      'content-type': 'application/octet-stream',
    },
    now,
  });

  return { uploadUrl, key, contentType: 'application/octet-stream' };
}

export function createSignedR2ObjectUrl(
  method: 'GET' | 'DELETE',
  key: string,
  now = new Date()
): string {
  return signR2S3Request({ method, key, now });
}
