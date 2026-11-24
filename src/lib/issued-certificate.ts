import { sendEmailV2 } from './api-client';
import { buildVerifyUrlFor } from './cert-registration';
import type { IssuedEventDesign } from './event-design';
import { ensureFontsLoaded } from './font-loader';
import { replaceTemplateVariables, sanitizeFilename } from './utils';
import { decodeDesignImage } from './workspace-loader';
import type { EmailSettings } from '../types';

const designImages = new WeakMap<IssuedEventDesign, Promise<HTMLImageElement>>();

async function renderIssuedCertificate(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string },
  formats: Pick<EmailSettings, 'attachJpg' | 'attachPng' | 'attachPdf'>,
) {
  const layout = design.layoutConfig;
  let image = designImages.get(design);
  if (!image) {
    image = decodeDesignImage(design).catch((error) => { designImages.delete(design); throw error; });
    designImages.set(design, image);
  }
  const fonts = new Set(layout.boxes.map((box) => box.fontFamily).filter(Boolean));
  if (layout.defaultFont) fonts.add(layout.defaultFont);
  await ensureFontsLoaded(fonts);

  const { generateCertificate } = await import('./certificate-engine');
  return generateCertificate({
    templateImage: await image,
    boxes: layout.boxes,
    row: fields,
    frozenFields: true,
    filename: sanitizeFilename(recipient.name),
    includePdf: formats.attachPdf,
    includePng: formats.attachPng,
    includeJpg: formats.attachJpg,
    qrZones: layout.qrZones,
    sampleQr: !recipient.id && Boolean(layout.qrZones?.length),
    images: layout.images,
    verificationUrl: recipient.id && layout.qrZones?.length ? buildVerifyUrlFor(recipient.id) : undefined,
  });
}

export async function renderIssuedPdf(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string },
) {
  const { filename, pdfBlob } = await renderIssuedCertificate(design, fields, recipient, { attachPdf: true, attachJpg: false });
  if (!pdfBlob) throw new Error('The certificate PDF could not be rendered.');
  return { filename, pdfBlob };
}

export async function renderIssuedPreview(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  name: string,
) {
  const { pngBlob } = await renderIssuedCertificate(design, fields, { name, id: '' }, { attachPng: true, attachPdf: false, attachJpg: false });
  if (!pngBlob) throw new Error('The certificate preview could not be rendered.');
  return pngBlob;
}

export async function prepareIssuedEmail(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string; email: string; resendVersion?: string },
  eventName: string,
  preferences?: EmailSettings | null,
  row?: Record<string, string> | null,
) {
  const settings = preferences ?? { attachPdf: true, attachJpg: false };
  if (!settings.attachJpg && !settings.attachPdf && !settings.attachPng) {
    throw new Error('This event’s email preferences need at least one attachment format.');
  }
  const cert = await renderIssuedCertificate(design, fields, recipient, settings);
  const values = { Name: recipient.name, Email: recipient.email, ...fields, ...row };
  const link = design.layoutConfig.qrZones?.length ? `\n\nVerify it here: ${buildVerifyUrlFor(recipient.id)}` : '';
  return {
    ...cert, certificateId: recipient.id, resendVersion: recipient.resendVersion, recipientEmail: recipient.email,
    emailSubject: preferences ? replaceTemplateVariables(preferences.subject, values) : `Your certificate from ${eventName}`,
    emailBodyHtml: preferences ? replaceTemplateVariables(preferences.bodyHtml, values, { html: true }) : '',
    emailBodyPlain: preferences ? replaceTemplateVariables(preferences.bodyPlain, values)
      : `Hi ${recipient.name},\n\nCongratulations! Your certificate is attached.${link}`,
  };
}

export async function emailIssuedCertificate(...args: Parameters<typeof prepareIssuedEmail>) {
  return sendEmailV2(await prepareIssuedEmail(...args));
}
