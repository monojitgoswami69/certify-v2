import { NextResponse } from 'next/server';
import { mutationAllowed, forbiddenCsrfResponse } from '../../../lib/server-auth';
import { createDecipheriv } from 'node:crypto';
import { boundedBody, BodyTooLarge } from '../../../lib/bounded-body';
import { requireIssuer, issuanceRequiredResponse } from '../../../lib/issuer-auth';
import { getFreshAccessToken, gmailConfigured } from '../../../lib/google-token-store';
import { reserveMailSlot } from '../../../lib/mail-quota';
import { log, requestIdOf } from '../../../lib/logger';
import { canClaimMail, claimMail, finishMail, getMailTarget } from '../../../lib/mail-delivery';
import { isValidCertificateId } from '../../../lib/verification';
import type { PersistedMailStatus } from '../../../types';
import { singleRecipientEmail } from '../../../lib/mail-preferences';
import { MAX_MAIL_ATTACHMENT_BYTES, MAX_STAGED_MAIL_BYTES, STAGED_MAIL_IV_BYTES, STAGED_MAIL_TAG_BYTES, unpackMailAttachments } from '../../../lib/mail-staging';
import { createSignedR2ObjectUrl, isAllowedMailStagingKey } from '../../../lib/r2-storage';
import { hasImageMagicBytes } from '../../../lib/image-validation';
import { buildRawMimeMessage, sanitizeAttachmentBaseName, type MailAttachment } from '../../../lib/gmail-mime';

const MAX_REQUEST_BYTES = 4_500_000;
const MAX_GMAIL_MESSAGE_BYTES = 35 * 1024 * 1024;

function decryptStagedMail(data: Buffer, hexKey: string): Buffer {
  if (data.length <= STAGED_MAIL_IV_BYTES + STAGED_MAIL_TAG_BYTES) {
    throw new SyntaxError('Truncated staged mail');
  }
  try {
    const iv = data.subarray(0, STAGED_MAIL_IV_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
    decipher.setAuthTag(data.subarray(-STAGED_MAIL_TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(STAGED_MAIL_IV_BYTES, -STAGED_MAIL_TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new SyntaxError('Invalid staged mail encryption');
  }
}

function retryLater(detail: string, seconds: number, source: 'account' | 'gmail') {
  return NextResponse.json({ status: 'rate_limited', detail, source }, {
    status: 429,
    headers: { 'Retry-After': String(seconds) },
  });
}

function unconfirmedEmail() {
  return NextResponse.json({
    status: 'unconfirmed',
    detail: 'Gmail acceptance could not be confirmed. Check Gmail Sent before sending again.',
  }, { status: 502 });
}

function blockedDelivery(status?: PersistedMailStatus) {
  if (!status) return NextResponse.json({ detail: 'Certificate and recipient do not match an active issued certificate.' }, { status: 404 });
  const detail = status === 'accepted' ? 'Gmail already accepted this certificate email.'
    : status === 'sending' ? 'A send is already in progress for this certificate.'
    : status === 'unknown' ? 'Review this send in Gmail Sent from the event before retrying.'
    : 'The delivery changed. Refresh the event and try again.';
  return NextResponse.json({ status: 'delivery_blocked', deliveryStatus: status, detail }, { status: 409 });
}

function reconnectRequired(email: string) {
  return NextResponse.json({
    status: 'reconnect_required',
    detail: `Authorize Gmail sending for ${email} in Studio and try again.`,
  }, { status: 401 });
}

async function readAttachment(file: FormDataEntryValue | null, filename: string): Promise<MailAttachment | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  if (file.size > MAX_MAIL_ATTACHMENT_BYTES) throw new BodyTooLarge();
  const buffer = Buffer.from(await file.arrayBuffer());
  return { filename, content: buffer };
}

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return forbiddenCsrfResponse();
  const { user, denial } = await requireIssuer(request);
  if (denial) return denial;

  if (!gmailConfigured()) {
    return NextResponse.json({ detail: 'Gmail sending is not configured. Contact your administrator.' }, { status: 503 });
  }

  let stagedKey: string | null = null;
  let stagedEncryptionKey = '';

  try {
    let certificateId: string;
    let resendVersion: string;
    let recipientEmail: string;
    let emailSubject: string;
    let emailBodyPlain: string;
    let emailBodyHtml: string;
    let filename: string;
    let attachments: MailAttachment[];
    const payload = boundedBody(request, MAX_REQUEST_BYTES);

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Optimized path: raw binary attachments (no base64 inflation).
      const form = await payload.formData();
      certificateId = String(form.get('certificate_id') || '');
      resendVersion = String(form.get('resend_version') || '');
      recipientEmail = String(form.get('recipient_email') || '');
      emailSubject = String(form.get('email_subject') || '');
      emailBodyPlain = String(form.get('email_body_plain') || '');
      emailBodyHtml = String(form.get('email_body_html') || '');
      filename = sanitizeAttachmentBaseName(String(form.get('filename') || 'certificate'));

      attachments = [];
      if (form.has('jpg') || form.has('jpeg')) {
        return NextResponse.json({ detail: 'Email attachments must use PNG or PDF.' }, { status: 400 });
      }
      const png = await readAttachment(form.get('png'), `${filename}.png`);
      if (png) attachments.push(png);
      const pdf = await readAttachment(form.get('pdf'), `${filename}.pdf`);
      if (pdf) attachments.push(pdf);
    } else {
      const body = await payload.json();
      if (!body || typeof body !== 'object') throw new SyntaxError('Invalid email payload');
      certificateId = String(body.certificate_id || '');
      resendVersion = String(body.resend_version || '');
      recipientEmail = String(body.recipient_email || '');
      emailSubject = String(body.email_subject || '');
      emailBodyPlain = String(body.email_body_plain || '');
      emailBodyHtml = String(body.email_body_html || '');
      filename = sanitizeAttachmentBaseName(String(body.filename || 'certificate'));

      attachments = [];
      if (body.staged_key !== undefined) {
        if (!isAllowedMailStagingKey(body.staged_key, user.userId)) {
          return NextResponse.json({ detail: 'Invalid staged email attachment reference' }, { status: 400 });
        }
        stagedKey = body.staged_key;
        if (typeof body.staged_encryption_key !== 'string' || !/^[0-9a-f]{64}$/.test(body.staged_encryption_key)) {
          return NextResponse.json({ detail: 'Invalid staged email encryption key. Refresh Studio and try again.' }, { status: 400 });
        }
        stagedEncryptionKey = body.staged_encryption_key;
      } else {
        if (body.jpg_base64 || body.jpeg_base64) {
          return NextResponse.json({ detail: 'Email attachments must use PNG or PDF.' }, { status: 400 });
        }
        if (body.png_base64) {
          attachments.push({
            filename: `${filename}.png`,
            content: Buffer.from(String(body.png_base64).replace(/^data:image\/\w+;base64,/, ''), 'base64'),
          });
        }
        if (body.pdf_base64) {
          attachments.push({
            filename: `${filename}.pdf`,
            content: Buffer.from(String(body.pdf_base64).replace(/^data:application\/pdf;base64,/, ''), 'base64'),
          });
        }
      }
    }

    recipientEmail = recipientEmail.trim();
    if (!isValidCertificateId(certificateId) || (resendVersion && !isValidCertificateId(resendVersion))) {
      return NextResponse.json({ detail: 'A valid issued certificate ID is required.' }, { status: 400 });
    }
    if (!recipientEmail || (!stagedKey && attachments.length === 0)) {
      return NextResponse.json(
        { detail: 'Recipient email and at least one attachment are required' },
        { status: 400 }
      );
    }

    // Exactly one address: a CSV cell like "a@x.com, b@y.com" must not fan out to multiple recipients
    if (recipientEmail.length > 320 || !singleRecipientEmail.test(recipientEmail)) {
      return NextResponse.json({ detail: `Invalid recipient email address: ${recipientEmail}` }, { status: 400 });
    }

    const target = await getMailTarget(user.userId, certificateId, recipientEmail);
    const resend = resendVersion || undefined;
    if (!target?.email || !canClaimMail(target, resend)) return blockedDelivery(target?.status);
    recipientEmail = target.email.trim();

    if (stagedKey) {
      const stagedRes = await fetch(createSignedR2ObjectUrl('GET', stagedKey), {
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!stagedRes.ok) {
        return NextResponse.json(
          { detail: 'Staged email attachments expired or could not be loaded.' },
          { status: 400 }
        );
      }
      const raw = Buffer.from(await boundedBody(stagedRes, MAX_STAGED_MAIL_BYTES).arrayBuffer());
      const unpacked = unpackMailAttachments(decryptStagedMail(raw, stagedEncryptionKey));
      for (const item of unpacked) {
        attachments.push({ filename: `${filename}.${item.slot}`, content: item.data });
      }
      if (attachments.length === 0) {
        return NextResponse.json({ detail: 'At least one attachment is required' }, { status: 400 });
      }
    }

    if (attachments.some(({ filename: name, content }) =>
      name.endsWith('.png') ? !hasImageMagicBytes(content, 'png') : content.subarray(0, 5).toString('ascii') !== '%PDF-'
    )) {
      return NextResponse.json({ detail: 'An attachment does not match its PNG or PDF format.' }, { status: 400 });
    }
    const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
    if (totalAttachmentBytes > MAX_MAIL_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { detail: 'Attachments exceed the 24 MB attachment limit.' },
        { status: 413 }
      );
    }

    emailSubject = emailSubject.replace(/[\r\n]+/g, ' ').slice(0, 998);
    const accessToken = await getFreshAccessToken(user);
    if (!accessToken) return reconnectRequired(user.email);

    const rawMime = await buildRawMimeMessage({
      from: { name: user.name, address: user.email },
      to: recipientEmail,
      subject: emailSubject,
      text: emailBodyPlain,
      html: emailBodyHtml.trim() || undefined,
      attachments,
    });
    if (rawMime.byteLength > MAX_GMAIL_MESSAGE_BYTES) {
      return NextResponse.json({ detail: 'The encoded email exceeds Gmail’s message size limit.' }, { status: 413 });
    }

    const claimStartedAt = performance.now();
    const attempt = await claimMail(user.userId, certificateId, recipientEmail, resend);
    if (!attempt) return blockedDelivery((await getMailTarget(user.userId, certificateId, recipientEmail))?.status);
    const finish = (status: Exclude<PersistedMailStatus, 'sending'>, detail: string | null, gmailId?: string) =>
      finishMail(user.userId, certificateId, attempt, status, detail, gmailId, resend);

    let slot: Awaited<ReturnType<typeof reserveMailSlot>>;
    try {
      slot = await reserveMailSlot(user.email);
    } catch (error) {
      await finish('failed', 'Could not reserve a sending slot.');
      throw error;
    }
    if (!slot.allowed) {
      await finish(target.status === 'failed' ? 'failed' : 'pending', 'Paused before submission to Gmail.');
      if (slot.retryAfter === null) return issuanceRequiredResponse();
      return retryLater('Your account has reached its sending limit.', slot.retryAfter, 'account');
    }
    // Decline delayed work while the claim is still fresh enough for the full
    // Gmail timeout. A stale execution must never send after manual review.
    if (performance.now() - claimStartedAt > 60_000) {
      await finish('failed', 'The send expired before submission to Gmail.');
      return NextResponse.json({ detail: 'The send expired before submission to Gmail.' }, { status: 503 });
    }

    let gmailRes: Response;
    try {
      gmailRes = await fetch(
        `https://gmail.googleapis.com/upload/gmail/v1/users/${encodeURIComponent(user.email)}/messages/send?uploadType=media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'message/rfc822' },
          body: rawMime,
          signal: AbortSignal.timeout(30_000),
        }
      );

    } catch {
      log.warn('email', 'No response from Gmail after submission', { requestId: requestIdOf(request), userId: user.userId });
      await finish('unknown', 'Gmail did not respond after submission.').catch(() => {});
      return unconfirmedEmail();
    }
    if (gmailRes.status >= 500 || gmailRes.status === 408) {
      await finish('unknown', 'Gmail returned an uncertain response after submission.').catch(() => {});
      return unconfirmedEmail();
    }

    if (gmailRes.ok) {
      const body = await gmailRes.json().catch(() => null);
      const gmailId = typeof body?.id === 'string' ? body.id.slice(0, 200) : undefined;
      const saved = await finish('accepted', null, gmailId).catch(() => false);
      if (!saved) return unconfirmedEmail();
      return NextResponse.json({ status: 'success', message: 'Email accepted by Gmail', recipient: recipientEmail });
    }
    await finish('failed', `Gmail rejected the submission (HTTP ${gmailRes.status}).`);
    if (gmailRes.status === 429) {
      const header = gmailRes.headers.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header)
        : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : NaN;
      return retryLater('Google has rate-limited this Gmail account.', seconds > 0 ? seconds : 60, 'gmail');
    }
    if (gmailRes.status === 401) return reconnectRequired(user.email);
    if (gmailRes.status === 403) {
      const data = await gmailRes.json().catch(() => null);
      const reasons: string[] = Array.isArray(data?.error?.errors)
        ? data.error.errors.map((item: { reason?: string }) => item?.reason)
        : [];
      if (reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded')) {
        return retryLater('Google has rate-limited this Gmail account.', 60, 'gmail');
      }
      if (reasons.includes('insufficientPermissions')) return reconnectRequired(user.email);
      return NextResponse.json({ detail: 'Gmail denied this send. Check your Google account and Workspace settings.' }, { status: 403 });
    }

    log.warn('email', 'Gmail rejected a send request', {
      requestId: requestIdOf(request), userId: user.userId, status: gmailRes.status,
    });
    return NextResponse.json({ detail: 'Gmail could not accept the email.' }, { status: 502 });
  } catch (error) {
    const isTooLarge =
      error instanceof BodyTooLarge ||
      (error instanceof Error && error.cause instanceof BodyTooLarge);
    if (isTooLarge) {
      return NextResponse.json({ detail: 'Email upload exceeds the size limit' }, { status: 413 });
    }
    if (error instanceof SyntaxError || error instanceof TypeError && error.message.includes('FormData')) {
      return NextResponse.json({ detail: 'Invalid email payload' }, { status: 400 });
    }
    log.error('email', 'Email request failed', { requestId: requestIdOf(request), userId: user.userId });
    return NextResponse.json({ detail: 'The email could not be prepared for Gmail.' }, { status: 500 });
  } finally {
    if (stagedKey) {
      try {
        const response = await fetch(createSignedR2ObjectUrl('DELETE', stagedKey), {
          method: 'DELETE',
          redirect: 'error',
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok && response.status !== 404) {
          log.warn('email', 'R2 rejected staged attachment deletion', { requestId: requestIdOf(request), status: response.status });
        }
      } catch (error) {
        log.warn('email', 'Failed to delete staged R2 attachment', { requestId: requestIdOf(request), userId: user.userId }, error);
      }
    }
  }
}
