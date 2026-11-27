import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';
import { Readable } from 'node:stream';

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

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export function sanitizeAttachmentBaseName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t\x00-\x1f]+/g, '_').trim().slice(0, 150);
  return cleaned || 'certificate';
}

export async function buildMimeMessageStream(mailOptions: SendMailOptions): Promise<Readable> {
  const info = await getMimeTransporter().sendMail(mailOptions);
  const msg = info.message;
  return Buffer.isBuffer(msg) ? Readable.from([msg], { objectMode: false }) : msg as Readable;
}

export async function buildRawMimeMessage(mailOptions: SendMailOptions): Promise<Buffer<ArrayBuffer>> {
  const stream = await buildMimeMessageStream(mailOptions);
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
