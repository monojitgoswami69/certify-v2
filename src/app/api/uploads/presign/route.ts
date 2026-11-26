import { NextResponse } from 'next/server';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { MAX_TEMPLATE_BYTES } from '../../../../lib/image-validation';
import { checkRateLimit } from '../../../../lib/rate-limit';
import {
  createPresignedTemplateUpload,
  isR2Configured,
  type TemplateUploadKind,
  type TemplateUploadMime,
} from '../../../../lib/r2-storage';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../lib/server-auth';

const ALLOWED_MIMES = new Set<TemplateUploadMime>(['image/png', 'image/jpeg', 'image/webp']);
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const PRESIGN_RATE_LIMIT = 20; // per user per minute

/**
 * Issues a short-lived Cloudflare R2 presigned PUT URL for authenticated issuers
 * so large (up to 15 MB) full-res templates and WebP previews upload directly from
 * the browser without hitting Vercel's 4.5 MB request payload ceiling.
 */
export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  const rate = checkRateLimit(`uploads:presign:${user.userId}`, PRESIGN_RATE_LIMIT, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many upload requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  let body: { contentType?: unknown; byteSize?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }

  const contentType = body.contentType;
  const kind: TemplateUploadKind = body.kind === 'preview' ? 'preview' : 'full';
  if (typeof contentType !== 'string' || !ALLOWED_MIMES.has(contentType as TemplateUploadMime)) {
    return NextResponse.json({ detail: 'Unsupported image content type' }, { status: 400 });
  }
  if (kind === 'preview' && contentType !== 'image/webp') {
    return NextResponse.json({ detail: 'Preview uploads must be image/webp' }, { status: 400 });
  }

  const maxBytes = kind === 'preview' ? MAX_PREVIEW_BYTES : MAX_TEMPLATE_BYTES;
  if (
    typeof body.byteSize !== 'number' ||
    !Number.isSafeInteger(body.byteSize) ||
    body.byteSize <= 0 ||
    body.byteSize > maxBytes
  ) {
    return NextResponse.json(
      { detail: `Template image is too large (max ${kind === 'preview' ? '2' : '15'} MB)` },
      { status: 413 }
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json({ enabled: false });
  }

  const presigned = createPresignedTemplateUpload({
    contentType: contentType as TemplateUploadMime,
    contentLength: body.byteSize,
    kind,
  });

  return NextResponse.json({
    enabled: true,
    uploadUrl: presigned.uploadUrl,
    publicUrl: presigned.publicUrl,
    contentType: presigned.contentType,
  });
}
