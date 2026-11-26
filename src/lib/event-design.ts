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
  /** Server-selected origin for reproducing this issued design’s QR codes. */
  verificationOrigin?: string;
  width: number;
  height: number;
  layoutConfig: EventLayout;
}
