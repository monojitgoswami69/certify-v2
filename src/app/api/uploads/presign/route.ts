import { NextResponse } from 'next/server';
import { boundedBody, BodyTooLarge } from '../../../../lib/bounded-body';
import { requireIssuer } from '../../../../lib/issuer-auth';
import { MAX_TEMPLATE_BYTES } from '../../../../lib/image-validation';
import { MAX_STAGED_MAIL_BYTES } from '../../../../lib/mail-staging';
import { canClaimMail, getMailTarget } from '../../../../lib/mail-delivery';
import { singleRecipientEmail } from '../../../../lib/mail-preferences';
import { isValidCertificateId } from '../../../../lib/verification';
import { log, requestIdOf } from '../../../../lib/logger';
import { checkRateLimit } from '../../../../lib/rate-limit';
import {
  createPresignedMailStagingUpload,
  createPresignedTemplateUpload,
  isR2Configured,
  MAX_R2_PREVIEW_BYTES,
  type TemplateUploadKind,
} from '../../../../lib/r2-storage';
import { forbiddenCsrfResponse, mutationAllowed } from '../../../../lib/server-auth';

const ALLOWED_TEMPLATE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PRESIGN_TEMPLATE_LIMIT = 20; // per user per minute
const PRESIGN_MAIL_LIMIT = 300; // per user per minute for parallel mail batches

/**
 * Issues a short-lived Cloudflare R2 presigned PUT URL for authenticated issuers
 * so large (up to 15 MB) templates and >3.5 MB email attachment envelopes
 * upload directly without hitting Vercel's 4.5 MB request payload ceiling.
 */
export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  let body: {
    contentType?: unknown; byteSize?: unknown; kind?: unknown;
    certificateId?: unknown; recipientEmail?: unknown; resendVersion?: unknown;
  };
  try {
    body = await boundedBody(request, 2048).json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError();
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return NextResponse.json({ detail: 'Upload request metadata is too large' }, { status: 413 });
    }
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 });
  }
  if (body.kind !== undefined && body.kind !== 'full' && body.kind !== 'preview' && body.kind !== 'mail-staging') {
    return NextResponse.json({ detail: 'Invalid upload kind' }, { status: 400 });
  }

  const contentType = body.contentType;
  const kind: TemplateUploadKind =
    body.kind === 'preview' ? 'preview'
    : body.kind === 'mail-staging' ? 'mail-staging'
    : 'full';

  const rateKey = kind === 'mail-staging' ? `uploads:presign-mail:${user.userId}` : `uploads:presign:${user.userId}`;
  const limit = kind === 'mail-staging' ? PRESIGN_MAIL_LIMIT : PRESIGN_TEMPLATE_LIMIT;
  const rate = checkRateLimit(rateKey, limit, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { detail: 'Too many upload requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  if (kind === 'mail-staging') {
    if (contentType !== 'application/octet-stream') {
      return NextResponse.json({ detail: 'Staged mail uploads must be application/octet-stream' }, { status: 400 });
    }
  } else {
    if (typeof contentType !== 'string' || !ALLOWED_TEMPLATE_MIMES.has(contentType)) {
      return NextResponse.json({ detail: 'Unsupported image content type' }, { status: 400 });
    }
    if (kind === 'preview' && contentType !== 'image/webp') {
      return NextResponse.json({ detail: 'Preview uploads must be image/webp' }, { status: 400 });
    }
  }

  const maxBytes =
    kind === 'preview' ? MAX_R2_PREVIEW_BYTES
    : kind === 'mail-staging' ? MAX_STAGED_MAIL_BYTES
    : MAX_TEMPLATE_BYTES;
  if (
    typeof body.byteSize !== 'number' ||
    !Number.isSafeInteger(body.byteSize) ||
    body.byteSize <= 0 ||
    body.byteSize > maxBytes
  ) {
    const label = kind === 'preview' ? '2' : kind === 'mail-staging' ? '25' : '15';
    return NextResponse.json(
      { detail: `Upload is too large (max ${label} MB)` },
      { status: 413 }
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json({ enabled: false });
  }

  if (kind === 'mail-staging') {
    const { certificateId, recipientEmail, resendVersion } = body;
    if (
      typeof certificateId !== 'string' || !isValidCertificateId(certificateId) ||
      typeof recipientEmail !== 'string' || recipientEmail.length > 320 || !singleRecipientEmail.test(recipientEmail) ||
      (resendVersion !== undefined && (typeof resendVersion !== 'string' || !isValidCertificateId(resendVersion)))
    ) {
      return NextResponse.json({ detail: 'A valid certificate and recipient are required to stage attachments.' }, { status: 400 });
    }
    let target: Awaited<ReturnType<typeof getMailTarget>>;
    try {
      target = await getMailTarget(user.userId, certificateId, recipientEmail);
    } catch (error) {
      log.error('uploads', 'Could not verify staged mail target', { requestId: requestIdOf(request), userId: user.userId }, error);
      return NextResponse.json({ detail: 'Could not prepare email attachments. Try again.' }, { status: 503 });
    }
    if (!target?.email) return NextResponse.json({ detail: 'Certificate and recipient were not found.' }, { status: 404 });
    if (!canClaimMail(target, resendVersion)) {
      return NextResponse.json({ status: 'delivery_blocked', deliveryStatus: target.status, detail: 'This delivery cannot be sent.' }, { status: 409 });
    }
    const staged = createPresignedMailStagingUpload({
      userId: user.userId,
      contentLength: body.byteSize,
    });
    return NextResponse.json({
      enabled: true,
      uploadUrl: staged.uploadUrl,
      key: staged.key,
      contentType: staged.contentType,
    });
  }

  const presigned = createPresignedTemplateUpload({
    userId: user.userId,
    contentType: contentType as 'image/png' | 'image/jpeg' | 'image/webp',
    contentLength: body.byteSize,
    kind,
  });

  return NextResponse.json({
    enabled: true,
    uploadUrl: presigned.uploadUrl,
    publicUrl: presigned.publicUrl,
    contentType: presigned.contentType,
    uploadHeaders: presigned.uploadHeaders,
  });
}
