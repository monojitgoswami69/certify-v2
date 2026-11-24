import { sendEmailV2 } from './api-client';
import { buildVerifyUrlFor } from './cert-registration';
import type { IssuedEventDesign } from './event-design';
import { ensureFontsLoaded } from './font-loader';
import { sanitizeFilename } from './utils';
import { decodeDesignImage } from './workspace-loader';

async function renderIssuedCertificate(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string },
  format: 'png' | 'pdf',
) {
  const layout = design.layoutConfig;
  const image = await decodeDesignImage(design);
  const fonts = new Set(layout.boxes.map((box) => box.fontFamily).filter(Boolean));
  if (layout.defaultFont) fonts.add(layout.defaultFont);
  await ensureFontsLoaded(fonts);

  const { generateCertificate } = await import('./certificate-engine');
  const cert = await generateCertificate({
    templateImage: image,
    boxes: layout.boxes,
    row: fields,
    frozenFields: true,
    filename: sanitizeFilename(recipient.name),
    includePdf: format === 'pdf',
    includePng: format === 'png',
    qrZones: recipient.id ? layout.qrZones : undefined,
    images: layout.images,
    verificationUrl: recipient.id && layout.qrZones?.length ? buildVerifyUrlFor(recipient.id) : undefined,
  });
  return cert;
}

export async function renderIssuedPdf(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string },
) {
  const { filename, pdfBlob } = await renderIssuedCertificate(design, fields, recipient, 'pdf');
  if (!pdfBlob) throw new Error('The certificate PDF could not be rendered.');
  return { filename, pdfBlob };
}

export async function renderIssuedPreview(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  name: string,
) {
  const { pngBlob } = await renderIssuedCertificate(design, fields, { name, id: '' }, 'png');
  if (!pngBlob) throw new Error('The certificate preview could not be rendered.');
  return pngBlob;
}

export async function emailIssuedCertificate(
  design: IssuedEventDesign,
  fields: Record<string, string>,
  recipient: { id: string; name: string; email: string },
  eventName: string,
) {
  const cert = await renderIssuedPdf(design, fields, recipient);
  const link = design.layoutConfig.qrZones?.length ? `\n\nVerify it here: ${buildVerifyUrlFor(recipient.id)}` : '';
  return sendEmailV2({
    ...cert, recipientEmail: recipient.email, emailSubject: `Your certificate from ${eventName}`, emailBodyHtml: '',
    emailBodyPlain: `Hi ${recipient.name},\n\nCongratulations! Your certificate is attached.${link}`,
  });
}
