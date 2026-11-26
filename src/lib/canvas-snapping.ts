/**
 * Smart Alignment Snapping & Guide Lines Engine
 *
 * Provides real-time magnetic snapping to:
 * 1. Certificate Center Lines (Horizontal & Vertical midpoints)
 * 2. Certificate Margins/Edges
 * 3. Adjacent Text Boxes, QR Zones, and Decorative Images (Edges & Centers)
 */

import type { ImageElement, TextBox } from '../types';
import type { QrZone } from '../store/useAppStore';

export type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface GuideLine {
  type: 'vertical' | 'horizontal';
  position: number; // in image coordinates
  label?: string;
  isCenter?: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  w?: number;
  h?: number;
  guides: GuideLine[];
}

export interface ResizeSnapResult {
  x: number;
  y: number;
  w: number;
  h: number;
  guides: GuideLine[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
}

interface AxisTarget {
  pos: number;
  isCenter: boolean;
}

const DEFAULT_SNAP_THRESHOLD = 8; // In image pixels

function collectSnapTargets(
  excludeId: string | undefined,
  templateWidth: number,
  templateHeight: number,
  otherBoxes: TextBox[],
  qrZone: QrZone[] | QrZone | null,
  images: ImageElement[] = []
): { vertical: AxisTarget[]; horizontal: AxisTarget[] } {
  const vertical: AxisTarget[] = [
    { pos: templateWidth / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateWidth, isCenter: false },
  ];
  const horizontal: AxisTarget[] = [
    { pos: templateHeight / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateHeight, isCenter: false },
  ];

  const addRect = (id: string | undefined, x: number, y: number, w: number, h: number) => {
    if (id === excludeId) return;
    vertical.push({ pos: x, isCenter: false }, { pos: x + w / 2, isCenter: true }, { pos: x + w, isCenter: false });
    horizontal.push({ pos: y, isCenter: false }, { pos: y + h / 2, isCenter: true }, { pos: y + h, isCenter: false });
  };

  for (const box of otherBoxes) addRect(box.id, box.x, box.y, box.w, box.h);
  const qrArray: QrZone[] = Array.isArray(qrZone) ? qrZone : qrZone ? [qrZone] : [];
  for (const zone of qrArray) addRect(zone.id, zone.x, zone.y, zone.size, zone.size);
  for (const img of images) addRect(img.id, img.x, img.y, img.w, img.h);

  return { vertical, horizontal };
}

function findNearestTarget(
  coord: number,
  targets: AxisTarget[],
  threshold: number,
  type: GuideLine['type']
): { pos: number; guide: GuideLine } | null {
  let minDelta = threshold + 1;
  let bestTarget: AxisTarget | null = null;
  for (const target of targets) {
    const delta = Math.abs(coord - target.pos);
    if (delta < minDelta && delta <= threshold) {
      minDelta = delta;
      bestTarget = target;
    }
  }
  return bestTarget
    ? { pos: bestTarget.pos, guide: { type, position: bestTarget.pos, isCenter: bestTarget.isCenter } }
    : null;
}

function snapMovingAxis(
  start: number,
  length: number,
  targets: AxisTarget[],
  threshold: number,
  type: GuideLine['type'],
  maxCoord: number
): { value: number; guide: GuideLine | null } {
  const candidates = [
    { coord: start, offset: 0 },
    { coord: start + length / 2, offset: length / 2 },
    { coord: start + length, offset: length },
  ];
  let bestDelta = threshold + 1;
  let bestSnapped: number | null = null;
  let bestGuide: GuideLine | null = null;

  for (const candidate of candidates) {
    for (const target of targets) {
      const delta = Math.abs(candidate.coord - target.pos);
      if (delta < bestDelta && delta <= threshold) {
        bestDelta = delta;
        bestSnapped = target.pos - candidate.offset;
        bestGuide = { type, position: target.pos, isCenter: target.isCenter };
      }
    }
  }

  return bestSnapped !== null && bestGuide
    ? { value: Math.max(0, Math.min(bestSnapped, maxCoord - length)), guide: bestGuide }
    : { value: start, guide: null };
}

/**
 * Calculates snapping for a moving rectangle against canvas boundaries and other elements.
 */
export function calculateMoveSnapping(
  current: Rect,
  templateWidth: number,
  templateHeight: number,
  otherBoxes: TextBox[],
  qrZone: QrZone[] | QrZone | null,
  _activeQrZone?: boolean,
  threshold: number = DEFAULT_SNAP_THRESHOLD,
  images: ImageElement[] = []
): SnapResult {
  const { vertical, horizontal } = collectSnapTargets(current.id, templateWidth, templateHeight, otherBoxes, qrZone, images);
  const xSnap = snapMovingAxis(current.x, current.w, vertical, threshold, 'vertical', templateWidth);
  const ySnap = snapMovingAxis(current.y, current.h, horizontal, threshold, 'horizontal', templateHeight);

  const guides: GuideLine[] = [];
  if (xSnap.guide) guides.push(xSnap.guide);
  if (ySnap.guide) guides.push(ySnap.guide);

  return { x: xSnap.value, y: ySnap.value, guides };
}

/**
 * Calculates snapping for a resizing box edge against adjacent elements and canvas midlines.
 */
export function calculateResizeSnapping(
  box: Rect,
  handle: HandleKey,
  templateWidth: number,
  templateHeight: number,
  otherBoxes: TextBox[],
  qrZone: QrZone[] | QrZone | null,
  _activeQrZone?: boolean,
  threshold: number = DEFAULT_SNAP_THRESHOLD,
  minSize = 12,
  images: ImageElement[] = []
): ResizeSnapResult {
  const guides: GuideLine[] = [];
  let { x, y, w, h } = box;
  const { vertical, horizontal } = collectSnapTargets(box.id, templateWidth, templateHeight, otherBoxes, qrZone, images);

  if (handle.includes('w')) {
    const match = findNearestTarget(x, vertical, threshold, 'vertical');
    if (match) {
      const right = x + w;
      const newX = Math.max(0, match.pos);
      const newW = right - newX;
      if (newW >= minSize) {
        x = newX;
        w = newW;
        guides.push(match.guide);
      }
    }
  } else if (handle.includes('e')) {
    const match = findNearestTarget(x + w, vertical, threshold, 'vertical');
    if (match) {
      const newRight = Math.min(templateWidth, match.pos);
      const newW = newRight - x;
      if (newW >= minSize) {
        w = newW;
        guides.push(match.guide);
      }
    }
  }

  if (handle.includes('n')) {
    const match = findNearestTarget(y, horizontal, threshold, 'horizontal');
    if (match) {
      const bottom = y + h;
      const newY = Math.max(0, match.pos);
      const newH = bottom - newY;
      if (newH >= minSize) {
        y = newY;
        h = newH;
        guides.push(match.guide);
      }
    }
  } else if (handle.includes('s')) {
    const match = findNearestTarget(y + h, horizontal, threshold, 'horizontal');
    if (match) {
      const newBottom = Math.min(templateHeight, match.pos);
      const newH = newBottom - y;
      if (newH >= minSize) {
        h = newH;
        guides.push(match.guide);
      }
    }
  }

  return { x, y, w, h, guides };
}

/**
 * Renders active alignment guide lines onto the 2D canvas with high-contrast styling.
 */
export function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  guides: GuideLine[],
  displayScale: number,
  canvasWidth: number,
  canvasHeight: number
) {
  if (guides.length === 0) return;

  ctx.save();

  guides.forEach((guide) => {
    const isCenter = guide.isCenter;
    const strokeColor = isCenter ? '#ec4899' : '#06b6d4'; // Magenta for center, Cyan for edges

    if (guide.type === 'vertical') {
      const x = Math.round(guide.position * displayScale) + 0.5;

      // Pure solid guide line
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    } else {
      const y = Math.round(guide.position * displayScale) + 0.5;

      // Pure solid guide line
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  });

  ctx.restore();
}
