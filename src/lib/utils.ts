/**
 * Utility functions for download, template substitution, email validation, and error reporting
 */

import type { EmailDeliveryRecord, CertificateGenerationRecord } from '../types';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/**
 * Robust template variable substitution supporting case-insensitive,
 * space-insensitive, and underscore-insensitive matching (e.g., {{Academic Year}} -> "AcademicYear").
 *
 * A normalized lookup map is memoized per `data` object (WeakMap) so the
 * fuzzy search is O(keys) once + O(1) per {{var}}, instead of O(vars*keys).
 */
const normalizedMapCache = new WeakMap<Record<string, string>, Record<string, string>>();

function getNormalizedMap(data: Record<string, string>): Record<string, string> {
  let map = normalizedMapCache.get(data);
  if (!map) {
    map = {};
    for (const k of Object.keys(data)) {
      map[k.toLowerCase().replace(/[\s_\-]/g, '')] = k;
    }
    normalizedMapCache.set(data, map);
  }
  return map;
}

export function replaceTemplateVariables(
  template: string,
  data: Record<string, string>
): string {
  if (!template) return '';
  const map = getNormalizedMap(data);
  return template.replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
    const key = rawKey.trim();

    // 1. Exact key match
    if (data[key] !== undefined && data[key] !== null) return data[key];

    // 2. Fuzzy case & space insensitive match
    const normalizedKey = key.toLowerCase().replace(/[\s_\-]/g, '');
    const foundKey = map[normalizedKey];

    if (foundKey && data[foundKey] !== undefined && data[foundKey] !== null) {
      return data[foundKey];
    }

    return match;
  });
}

/**
 * Validates email syntax strictly and checks for common domain typos.
 */
export function validateEmailAddress(rawEmail: string): { valid: boolean; email: string; warning?: string } {
  const email = (rawEmail || '').trim();
  if (!email) {
    return { valid: false, email: '', warning: 'Email is empty' };
  }

  // RFC-5322 strict email syntax regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(email)) {
    return { valid: false, email, warning: 'Invalid email syntax format' };
  }

  // Domain typo detection
  const domain = email.split('@')[1]?.toLowerCase();
  const typos: Record<string, string> = {
    'gmaill.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yaho.co.in': 'yahoo.co.in',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
  };

  if (domain && typos[domain]) {
    return {
      valid: true,
      email,
      warning: `Possible email domain typo: "${domain}" (did you mean "${typos[domain]}"?)`,
    };
  }

  return { valid: true, email };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeFilename(text: string): string {
  const safe = text.replace(/[^a-zA-Z0-9\s\-_]/g, '');
  return safe.trim().replace(/\s+/g, '_').substring(0, 50) || 'certificate';
}

export interface ErrorRecord {
  rowIndex: number;
  name: string;
  email?: string;
  error: string;
}

export function generateErrorReportCsv(
  errors: ErrorRecord[],
  type: 'email' | 'generation'
): string {
  const headers = type === 'email' ? ['Row', 'Name', 'Email', 'Error'] : ['Row', 'Name', 'Error'];

  const rows = errors.map((err) => {
    if (type === 'email') {
      return [
        err.rowIndex.toString(),
        `"${(err.name || '').replace(/"/g, '""')}"`,
        `"${(err.email || '').replace(/"/g, '""')}"`,
        `"${(err.error || '').replace(/"/g, '""')}"`,
      ];
    } else {
      return [
        err.rowIndex.toString(),
        `"${(err.name || '').replace(/"/g, '""')}"`,
        `"${(err.error || '').replace(/"/g, '""')}"`,
      ];
    }
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadErrorReport(errors: ErrorRecord[], type: 'email' | 'generation'): void {
  const csvContent = generateErrorReportCsv(errors, type);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `failed_${type === 'email' ? 'emails' : 'certificates'}_${dateStr}.csv`;
  downloadBlob(blob, filename);
}

export function generateFullDeliveryReportCsv(
  records: EmailDeliveryRecord[],
  eventName?: string
): string {
  const headers = ['Row', 'Recipient Name', 'Email Address', 'Delivery Status', 'Timestamp', 'Diagnostics / Reason', 'Event'];
  const rows = records.map((rec) => [
    rec.rowIndex.toString(),
    `"${(rec.name || '').replace(/"/g, '""')}"`,
    `"${(rec.email || '').replace(/"/g, '""')}"`,
    `"${rec.status.toUpperCase()}"`,
    `"${rec.timestamp || ''}"`,
    `"${(rec.error || (rec.status === 'sent' ? 'Successfully Delivered' : '')).replace(/"/g, '""')}"`,
    `"${(eventName || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadFullDeliveryReport(
  records: EmailDeliveryRecord[],
  eventName?: string
): void {
  const csvContent = generateFullDeliveryReportCsv(records, eventName);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
  const filename = `delivery_report_${safeEvent}${dateStr}.csv`;
  downloadBlob(blob, filename);
}

export function generateFullGenerationReportCsv(
  records: CertificateGenerationRecord[],
  eventName?: string
): string {
  const headers = [
    'Row',
    'Recipient Name',
    'Filename',
    'Generation Status',
    'Formats',
    'Certificate ID',
    'Verification URL',
    'Timestamp',
    'Diagnostics / Error',
    'Event',
  ];

  const rows = records.map((rec) => [
    rec.rowIndex.toString(),
    `"${(rec.name || '').replace(/"/g, '""')}"`,
    `"${(rec.filename || '').replace(/"/g, '""')}"`,
    `"${rec.status.toUpperCase()}"`,
    `"${(rec.formats || []).join('+')}"`,
    `"${(rec.certId || '').replace(/"/g, '""')}"`,
    `"${(rec.verificationUrl || '').replace(/"/g, '""')}"`,
    `"${rec.timestamp || ''}"`,
    `"${(rec.error || (rec.status === 'generated' ? 'Successfully Generated' : '')).replace(/"/g, '""')}"`,
    `"${(eventName || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadFullGenerationReport(
  records: CertificateGenerationRecord[],
  eventName?: string
): void {
  const csvContent = generateFullGenerationReportCsv(records, eventName);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
  const filename = `generation_report_${safeEvent}${dateStr}.csv`;
  downloadBlob(blob, filename);
}

/**
 * Reconstructs a virtual CSV File object and row records from participant data.
 * Used when auto-populating Studio from a saved event batch.
 */
export function buildVirtualCsvFile(
  eventName: string,
  participants: Array<{
    recipientName: string;
    recipientEmail?: string | null;
    rowData?: Record<string, string> | null;
  }>
): { file: File; headers: string[]; rows: Array<Record<string, string>> } {
  const headersSet = new Set<string>();
  const rows: Array<Record<string, string>> = [];

  for (const p of participants) {
    let row: Record<string, string> = {};
    if (p.rowData && typeof p.rowData === 'object' && Object.keys(p.rowData).length > 0) {
      row = { ...p.rowData };
    } else {
      row = {
        'Full Name': p.recipientName,
        ...(p.recipientEmail ? { Email: p.recipientEmail } : {}),
      };
    }
    Object.keys(row).forEach((k) => headersSet.add(k));
    rows.push(row);
  }

  if (headersSet.size === 0) {
    headersSet.add('Full Name');
  }

  const headers = Array.from(headersSet);
  const csvLines = [
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map((r) =>
      headers.map((h) => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const csvContent = csvLines.join('\n');
  const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = `${sanitizeFilename(eventName || 'event')}.csv`;
  const file = new File([csvBlob], filename, { type: 'text/csv' });

  return { file, headers, rows };
}
