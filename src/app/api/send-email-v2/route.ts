import { NextResponse } from 'next/server';
import nodemailer, { Transporter } from 'nodemailer';
import { Readable } from 'stream';
import { getAuthUserFromRequest, unauthorizedResponse } from '../../../lib/server-auth';
import { buildGoogleOAuthClient } from '../../../lib/google-token-store';

// =========================================================================
// Shared MIME builder (streamTransport never opens a socket, so a single
// singleton transporter is safe and avoids per-request allocation churn).
// =========================================================================
let mimeTransporter: Transporter | null = null;
function getMimeTransporter(): Transporter {
  if (!mimeTransporter) {
    mimeTransporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'windows',
      disableUrlAccess: true,
      disableFileAccess: true,
    });
  }
  return mimeTransporter;
}

async function buildRawMimeMessage(mailOptions: nodemailer.SendMailOptions): Promise<Uint8Array> {
  const info = await getMimeTransporter().sendMail(mailOptions);
  const msg = info.message;

  if (Buffer.isBuffer(msg)) {
    return new Uint8Array(msg);
  }

  const stream = msg as Readable;
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}

interface MailAttachment {
  filename: string;
  content: Buffer;
}

async function readAttachment(file: File | null, filename: string): Promise<MailAttachment | null> {
  if (!file || file.size === 0) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  return { filename, content: buffer };
}

export async function POST(request: Request) {
  const username = getAuthUserFromRequest(request);
  if (!username) {
    return unauthorizedResponse('Invalid or expired token');
  }

  try {
    let recipientEmail: string;
    let emailSubject: string;
    let emailBodyPlain: string;
    let emailBodyHtml: string;
    let filename: string;
    let attachments: MailAttachment[];
    let clientAccessToken: string | undefined;
    let senderEmail: string | undefined;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Optimized path: raw binary attachments (no base64 inflation).
      const form = await request.formData();
      recipientEmail = String(form.get('recipient_email') || '');
      emailSubject = String(form.get('email_subject') || '');
      emailBodyPlain = String(form.get('email_body_plain') || '');
      emailBodyHtml = String(form.get('email_body_html') || '');
      filename = String(form.get('filename') || 'certificate');
      clientAccessToken = form.get('google_access_token')
        ? String(form.get('google_access_token'))
        : undefined;
      senderEmail = form.get('sender_email') ? String(form.get('sender_email')) : undefined;

      attachments = [];
      const jpg = await readAttachment(
        (form.get('jpg') as File | null) || (form.get('jpeg') as File | null) || null,
        `${filename}.jpg`
      );
      if (jpg) attachments.push(jpg);
      const png = await readAttachment((form.get('png') as File | null) || null, `${filename}.png`);
      if (png) attachments.push(png);
      const pdf = await readAttachment((form.get('pdf') as File | null) || null, `${filename}.pdf`);
      if (pdf) attachments.push(pdf);
    } else {
      // Legacy JSON + base64 fallback (kept for backward compatibility).
      const body = await request.json();
      recipientEmail = body.recipient_email || '';
      emailSubject = body.email_subject || '';
      emailBodyPlain = body.email_body_plain || '';
      emailBodyHtml = body.email_body_html || '';
      filename = body.filename || 'certificate';
      clientAccessToken = body.google_access_token;
      senderEmail = body.sender_email && body.sender_email.includes('@') ? body.sender_email : undefined;

      attachments = [];
      if (body.jpg_base64 || body.jpeg_base64) {
        attachments.push({
          filename: `${filename}.jpg`,
          content: Buffer.from(String(body.jpg_base64 || body.jpeg_base64).replace(/^data:image\/\w+;base64,/, ''), 'base64'),
        });
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

    if (!recipientEmail || attachments.length === 0) {
      return NextResponse.json(
        { detail: 'Recipient email and at least one attachment are required' },
        { status: 400 }
      );
    }

    // =========================================================================
    // Resolve a Gmail access token. Prefer server-stored credentials (which
    // auto-refresh via the refresh token); fall back to the client-supplied
    // token if the server store is empty (e.g. after a server restart).
    // =========================================================================
    let accessToken: string | null | undefined = null;
    let usedServerCreds = false;

    const oauthClient = buildGoogleOAuthClient(username);
    if (oauthClient) {
      try {
        const { token } = await oauthClient.getAccessToken();
        accessToken = token;
        usedServerCreds = true;
      } catch (err) {
        console.warn('[Gmail dispatch] server credential refresh failed:', err);
      }
    }

    if (!accessToken && clientAccessToken) {
      accessToken = clientAccessToken;
    }

    if (accessToken) {
      const validSender = senderEmail && senderEmail.includes('@') ? senderEmail : undefined;

      const mailOptions: nodemailer.SendMailOptions = {
        from: validSender,
        to: recipientEmail,
        subject: emailSubject,
        text: emailBodyPlain,
        html: emailBodyHtml && emailBodyHtml.trim() ? emailBodyHtml : undefined,
        attachments,
      };

      const rawMime = await buildRawMimeMessage(mailOptions);

      // Auto-retry up to 3 times for transient (429 / 503 / precondition) errors.
      let attempts = 0;
      let lastErrorMessage = '';
      let lastStatus = 0;

      while (attempts < 3) {
        attempts++;
        const gmailRes = await fetch(
          'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'message/rfc822',
            },
            body: Buffer.from(rawMime) as unknown as BodyInit,
          }
        );

        if (gmailRes.ok) {
          return NextResponse.json({
            status: 'success',
            message: `Email sent via Google OAuth to ${recipientEmail}`,
            recipient: recipientEmail,
          });
        }

        lastStatus = gmailRes.status;
        const errData = await gmailRes.json().catch(() => ({}));
        lastErrorMessage = errData.error?.message || `Gmail API returned HTTP ${gmailRes.status}`;

        // 401 / 403 (auth) -> do NOT retry; surface reconnect signal.
        if (gmailRes.status === 401 || gmailRes.status === 403) {
          break;
        }

        if (
          attempts < 3 &&
          (lastErrorMessage.toLowerCase().includes('precondition') ||
            gmailRes.status === 429 ||
            gmailRes.status === 503)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempts));
          continue;
        }

        break;
      }

      // Auth-class failure means the session is dead -> ask client to reconnect.
      if (lastStatus === 401 || lastStatus === 403) {
        return NextResponse.json(
          {
            status: 'reconnect_required',
            detail: usedServerCreds
              ? 'Google session expired. Please reconnect your Google account.'
              : lastErrorMessage,
          },
          { status: 401 }
        );
      }

      throw new Error(`Gmail API error: ${lastErrorMessage}`);
    }

    // Google-only: if we reach here, no usable access token was available
    // (account not connected or session lost). Surface a clear error rather
    // than silently dropping the mail.
    return NextResponse.json(
      {
        status: 'reconnect_required',
        detail: 'No Google account connected. Please connect your Google account and retry.',
      },
      { status: 401 }
    );
  } catch (error) {
    console.error('[Email Dispatch Error]:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}
