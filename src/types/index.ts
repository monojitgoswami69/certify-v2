/**
 * TypeScript Interfaces & Types for Certify™ Next.js
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

export type QrBodyShape =
  | 'square'
  | 'rounded-connected'
  | 'smooth'
  | 'dots'
  | 'extra-rounded'
  | 'classy'
  | 'classy-rounded'
  | 'horizontal'
  | 'vertical'
  | 'diamond'
  | 'star'
  | 'hexagon'
  | 'mosaic'
  | 'leaf'
  | 'rounded';
export type QrEyeFrameShape =
  | 'square'
  | 'rounded'
  | 'extra-rounded'
  | 'circle'
  | 'leaf'
  | 'leaf-inverted'
  | 'pointed-leaf'
  | 'diamond'
  | 'shield';
export type QrEyeDotShape =
  | 'square'
  | 'dot'
  | 'rounded'
  | 'diamond'
  | 'star'
  | 'cross'
  | 'leaf'
  | 'ring';
export type QrCenterShape = 'square' | 'circle' | 'rounded' | 'shield' | 'diamond';

export interface QrStyleConfig {
  bodyShape?: QrBodyShape;
  eyeFrameShape?: QrEyeFrameShape;
  eyeDotShape?: QrEyeDotShape;
  patternColor?: string;
  eyeFrameColor?: string;
  eyeDotColor?: string;
  backgroundColor?: string;
  logo?: string;
  centerShape?: QrCenterShape;
}

export interface QrZone {
  id: string;
  x: number;
  y: number;
  size: number;
  style?: QrStyleConfig;
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

