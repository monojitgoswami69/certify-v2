import type { ImageElement, QrZone, TextBox } from '../types';

export interface EventLayout {
  boxes: TextBox[];
  qrZones?: QrZone[];
  images?: ImageElement[];
  defaultFont?: string;
  defaultFontSize?: number;
  defaultFontColor?: string;
}

export interface IssuedEventDesign {
  imageData: string;
  /** Optional compressed WebP preview (<= 1400px longest edge) generated at issuance. */
  previewImageData?: string;
  previewWidth?: number;
  previewHeight?: number;
  /** Server-selected origin for reproducing this issued design’s QR codes. */
  verificationOrigin?: string;
  /** Account issuer label captured when this event was issued. */
  issuedBy?: string;
  width: number;
  height: number;
  layoutConfig: EventLayout;
}
