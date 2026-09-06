/**
 * TypeScript Interfaces & Types for Credify™ Next.js
 */

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  field: string;
  fontSize: number;
  fontColor: string;
  fontFamily: string;
  hAlign: HorizontalAlign;
  vAlign: VerticalAlign;
}

export type FontCategory = 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';

export interface Font {
  family: string;
  category: FontCategory;
  variants: string[];
  popularity: number;
}

export interface CsvRow {
  [key: string]: string;
}

export type ViewMode = 'certificate' | 'email';

export interface EmailSettings {
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
  attachPdf: boolean;
  attachJpg: boolean;
  attachPng?: boolean;
}

export type EmailDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface EmailDeliveryRecord {
  rowIndex: number;
  name: string;
  email: string;
  status: EmailDeliveryStatus;
  timestamp?: string;
  error?: string;
}

export interface EmailProgress {
  current: number;
  total: number;
  currentRecipient: string;
  status: 'idle' | 'sending' | 'paused' | 'completed' | 'error';
  errors: Array<{
    rowIndex: number;
    name: string;
    email: string;
    error: string;
    failedAt?: string;
  }>;
  sent: Array<{
    rowIndex: number;
    name: string;
    email: string;
    sentAt?: string;
  }>;
  records?: EmailDeliveryRecord[];
}

export interface QrZone {
  id: string;
  x: number;
  y: number;
  size: number;
}

export type CertificateGenerationStatus = 'pending' | 'generating' | 'generated' | 'failed';

export interface CertificateGenerationRecord {
  rowIndex: number;
  name: string;
  filename: string;
  status: CertificateGenerationStatus;
  formats: string[];
  certId?: string;
  verificationUrl?: string;
  timestamp?: string;
  error?: string;
}

export interface ExportFormats {
  png: boolean;
  jpg: boolean;
  pdf: boolean;
}

