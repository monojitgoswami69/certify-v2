import type { EmailSettings } from '../types';

export const singleRecipientEmail = /^[^\s@,;<>"\x00-\x1f]+@[^\s@,;<>"\x00-\x1f]+\.[^\s@,;<>"\x00-\x1f]+$/;

export function readMailPreferences(value: unknown): EmailSettings | null {
  if (!value || typeof value !== 'object') return null;
  const settings = value as Partial<EmailSettings>;
  if (typeof settings.subject !== 'string' || settings.subject.length > 998
    || typeof settings.bodyPlain !== 'string' || settings.bodyPlain.length > 100_000
    || typeof settings.bodyHtml !== 'string' || settings.bodyHtml.length > 100_000
    || typeof settings.attachPdf !== 'boolean'
    || (settings.attachJpg !== undefined && typeof settings.attachJpg !== 'boolean')
    || (settings.attachPng !== undefined && typeof settings.attachPng !== 'boolean')) return null;
  const { subject, bodyPlain, bodyHtml, attachPdf, attachJpg = false, attachPng = false } = settings;
  return { subject, bodyPlain, bodyHtml, attachPdf, attachJpg, attachPng };
}
