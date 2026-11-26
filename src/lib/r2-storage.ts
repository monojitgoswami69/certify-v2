import crypto from 'node:crypto';
import { env } from './env';

export type TemplateUploadMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type TemplateUploadKind = 'full' | 'preview';

const PRESIGN_EXPIRY_SECONDS = 300;
const EXTENSION_BY_MIME: Record<TemplateUploadMime, string> = {
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
  if (!isR2Configured() || !env.R2_PUBLIC_BASE_URL) return null;
  return env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
}

const R2_FULL_PATH_RE = /\/designs\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;
const R2_PREVIEW_PATH_RE = /\/designs\/[0-9a-f-]{36}\/[0-9a-f]{32}-preview\.webp$/;

/**
 * Verifies that a submitted external image URL strictly targets our configured
 * Cloudflare R2 public origin and uses our random capability path format.
 */
export function isAllowedR2TemplateUrl(
  value: unknown,
  kind?: TemplateUploadKind
): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  const baseUrl = getR2PublicBaseUrl();
  if (!baseUrl) return false;

  try {
    const parsed = new URL(value);
    const expectedBase = new URL(baseUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== expectedBase.origin ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return false;
    }
    const basePrefix = expectedBase.pathname.replace(/\/+$/, '');
    if (basePrefix && !parsed.pathname.startsWith(`${basePrefix}/`)) return false;
    const relPath = basePrefix ? parsed.pathname.slice(basePrefix.length) : parsed.pathname;
    if (kind === 'preview') return R2_PREVIEW_PATH_RE.test(relPath);
    if (kind === 'full') return R2_FULL_PATH_RE.test(relPath);
    return R2_FULL_PATH_RE.test(relPath) || R2_PREVIEW_PATH_RE.test(relPath);
  } catch {
    return false;
  }
}

export function createPresignedTemplateUpload({
  contentType,
  kind = 'full',
  now = new Date(),
}: {
  contentType: TemplateUploadMime;
  kind?: TemplateUploadKind;
  now?: Date;
}): {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: TemplateUploadMime;
} {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 storage is not configured');
  }

  const accountId = env.R2_ACCOUNT_ID!;
  const bucket = env.R2_BUCKET!;
  const accessKeyId = env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY!;
  const publicBase = getR2PublicBaseUrl()!;

  const ext = EXTENSION_BY_MIME[contentType];
  const suffix = kind === 'preview' ? '-preview' : '';
  const key = `designs/${crypto.randomUUID()}/${crypto.randomBytes(16).toString('hex')}${suffix}.${ext}`;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${rfc3986Encode(bucket)}/${key.split('/').map(rfc3986Encode).join('/')}`;

  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = iso.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', iso],
    ['X-Amz-Expires', String(PRESIGN_EXPIRY_SECONDS)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ];
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'content-type;host',
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

  return {
    uploadUrl: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    publicUrl: `${publicBase}/${key}`,
    key,
    contentType,
  };
}
