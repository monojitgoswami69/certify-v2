/**
 * Smart Alignment Snapping & Guide Lines Engine
 * 
 * Provides real-time magnetic snapping to:
 * 1. Certificate Center Lines (Horizontal & Vertical midpoints)
 * 2. Certificate Margins/Edges
 * 3. Adjacent Text Boxes & QR Zone (Edges & Centers)
 */

import type { TextBox } from '../types';
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

const DEFAULT_SNAP_THRESHOLD = 8; // In image pixels

/**
 * Calculates snapping for a moving rectangle against the canvas boundaries and other elements.
 */
export function calculateMoveSnapping(
  current: Rect,
  templateWidth: number,
  templateHeight: number,
  otherBoxes: TextBox[],
  qrZone: QrZone[] | QrZone | null,
  activeQrZone: boolean,
  threshold: number = DEFAULT_SNAP_THRESHOLD
): SnapResult {
  const guides: GuideLine[] = [];
  let snappedX = current.x;
  let snappedY = current.y;

  // 1. Collect target vertical guide positions (X axes)
  const verticalTargets: Array<{ pos: number; isCenter: boolean }> = [
    { pos: templateWidth / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateWidth, isCenter: false },
  ];

  // 2. Collect target horizontal guide positions (Y axes)
  const horizontalTargets: Array<{ pos: number; isCenter: boolean }> = [
    { pos: templateHeight / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateHeight, isCenter: false },
  ];

  // Add target lines from other text boxes
  otherBoxes.forEach((box) => {
    if (box.id === current.id) return;
    verticalTargets.push(
      { pos: box.x, isCenter: false },
      { pos: box.x + box.w / 2, isCenter: true },
      { pos: box.x + box.w, isCenter: false }
    );
    horizontalTargets.push(
      { pos: box.y, isCenter: false },
      { pos: box.y + box.h / 2, isCenter: true },
      { pos: box.y + box.h, isCenter: false }
    );
  });

  // Add target lines from inactive QR zones
  const qrArray: QrZone[] = Array.isArray(qrZone) ? qrZone : qrZone ? [qrZone] : [];
  qrArray.forEach((zone) => {
    if (zone.id === current.id) return;
    verticalTargets.push(
      { pos: zone.x, isCenter: false },
      { pos: zone.x + zone.size / 2, isCenter: true },
      { pos: zone.x + zone.size, isCenter: false }
    );
    horizontalTargets.push(
      { pos: zone.y, isCenter: false },
      { pos: zone.y + zone.size / 2, isCenter: true },
      { pos: zone.y + zone.size, isCenter: false }
    );
  });

  // --- X-AXIS SNAPPING ---
  const currentLeft = current.x;
  const currentCenterX = current.x + current.w / 2;
  const currentRight = current.x + current.w;

  let minDeltaX = threshold + 1;
  let bestSnapX: number | null = null;
  let bestVerticalGuide: GuideLine | null = null;

  for (const target of verticalTargets) {
    // Check Left edge snap
    const dLeft = Math.abs(currentLeft - target.pos);
    if (dLeft < minDeltaX && dLeft <= threshold) {
      minDeltaX = dLeft;
      bestSnapX = target.pos;
      bestVerticalGuide = {
        type: 'vertical',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }

    // Check Center snap
    const dCenter = Math.abs(currentCenterX - target.pos);
    if (dCenter < minDeltaX && dCenter <= threshold) {
      minDeltaX = dCenter;
      bestSnapX = target.pos - current.w / 2;
      bestVerticalGuide = {
        type: 'vertical',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }

    // Check Right edge snap
    const dRight = Math.abs(currentRight - target.pos);
    if (dRight < minDeltaX && dRight <= threshold) {
      minDeltaX = dRight;
      bestSnapX = target.pos - current.w;
      bestVerticalGuide = {
        type: 'vertical',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }
  }

  if (bestSnapX !== null && bestVerticalGuide) {
    snappedX = Math.max(0, Math.min(bestSnapX, templateWidth - current.w));
    guides.push(bestVerticalGuide);
  }

  // --- Y-AXIS SNAPPING ---
  const currentTop = current.y;
  const currentCenterY = current.y + current.h / 2;
  const currentBottom = current.y + current.h;

  let minDeltaY = threshold + 1;
  let bestSnapY: number | null = null;
  let bestHorizontalGuide: GuideLine | null = null;

  for (const target of horizontalTargets) {
    // Check Top edge snap
    const dTop = Math.abs(currentTop - target.pos);
    if (dTop < minDeltaY && dTop <= threshold) {
      minDeltaY = dTop;
      bestSnapY = target.pos;
      bestHorizontalGuide = {
        type: 'horizontal',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }

    // Check Center snap
    const dCenter = Math.abs(currentCenterY - target.pos);
    if (dCenter < minDeltaY && dCenter <= threshold) {
      minDeltaY = dCenter;
      bestSnapY = target.pos - current.h / 2;
      bestHorizontalGuide = {
        type: 'horizontal',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }

    // Check Bottom edge snap
    const dBottom = Math.abs(currentBottom - target.pos);
    if (dBottom < minDeltaY && dBottom <= threshold) {
      minDeltaY = dBottom;
      bestSnapY = target.pos - current.h;
      bestHorizontalGuide = {
        type: 'horizontal',
        position: target.pos,
        isCenter: target.isCenter,
      };
    }
  }

  if (bestSnapY !== null && bestHorizontalGuide) {
    snappedY = Math.max(0, Math.min(bestSnapY, templateHeight - current.h));
    guides.push(bestHorizontalGuide);
  }

  return { x: snappedX, y: snappedY, guides };
}

/**
 * Calculates snapping for a resizing box edge against adjacent boxes and canvas midlines.
 */
export function calculateResizeSnapping(
  box: Rect,
  handle: HandleKey,
  templateWidth: number,
  templateHeight: number,
  otherBoxes: TextBox[],
  qrZone: QrZone[] | QrZone | null,
  activeQrZone: boolean,
  threshold: number = DEFAULT_SNAP_THRESHOLD
): ResizeSnapResult {
  const guides: GuideLine[] = [];
  let { x, y, w, h } = box;

  // 1. Collect target vertical guide positions (X axes)
  const verticalTargets: Array<{ pos: number; isCenter: boolean }> = [
    { pos: templateWidth / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateWidth, isCenter: false },
  ];

  // 2. Collect target horizontal guide positions (Y axes)
  const horizontalTargets: Array<{ pos: number; isCenter: boolean }> = [
    { pos: templateHeight / 2, isCenter: true },
    { pos: 0, isCenter: false },
    { pos: templateHeight, isCenter: false },
  ];

  // Add target lines from other text boxes
  otherBoxes.forEach((other) => {
    if (other.id === box.id) return;
    verticalTargets.push(
      { pos: other.x, isCenter: false },
      { pos: other.x + other.w / 2, isCenter: true },
      { pos: other.x + other.w, isCenter: false }
    );
    horizontalTargets.push(
      { pos: other.y, isCenter: false },
      { pos: other.y + other.h / 2, isCenter: true },
      { pos: other.y + other.h, isCenter: false }
    );
  });

  // Add target lines from inactive QR zones
  const qrArray: QrZone[] = Array.isArray(qrZone) ? qrZone : qrZone ? [qrZone] : [];
  qrArray.forEach((zone) => {
    if (zone.id === box.id) return;
    verticalTargets.push(
      { pos: zone.x, isCenter: false },
      { pos: zone.x + zone.size / 2, isCenter: true },
      { pos: zone.x + zone.size, isCenter: false }
    );
    horizontalTargets.push(
      { pos: zone.y, isCenter: false },
      { pos: zone.y + zone.size / 2, isCenter: true },
      { pos: zone.y + zone.size, isCenter: false }
    );
  });

  // Handle West edge snapping (x changes, w changes)
  if (handle.includes('w')) {
    let minDelta = threshold + 1;
    let snapX: number | null = null;
    let bestGuide: GuideLine | null = null;
    for (const target of verticalTargets) {
      const d = Math.abs(x - target.pos);
      if (d < minDelta && d <= threshold) {
        minDelta = d;
        snapX = target.pos;
        bestGuide = { type: 'vertical', position: target.pos, isCenter: target.isCenter };
      }
    }
    if (snapX !== null && bestGuide) {
      const right = x + w;
      const newX = Math.max(0, snapX);
      const newW = right - newX;
      if (newW >= 20) {
        x = newX;
        w = newW;
        guides.push(bestGuide);
      }
    }
  }

  // Handle East edge snapping (x fixed, w changes)
  if (handle.includes('e')) {
    const right = x + w;
    let minDelta = threshold + 1;
    let snapRight: number | null = null;
    let bestGuide: GuideLine | null = null;
    for (const target of verticalTargets) {
      const d = Math.abs(right - target.pos);
      if (d < minDelta && d <= threshold) {
        minDelta = d;
        snapRight = target.pos;
        bestGuide = { type: 'vertical', position: target.pos, isCenter: target.isCenter };
      }
    }
    if (snapRight !== null && bestGuide) {
      const newRight = Math.min(templateWidth, snapRight);
      const newW = newRight - x;
      if (newW >= 20) {
        w = newW;
        guides.push(bestGuide);
      }
    }
  }

  // Handle North edge snapping (y changes, h changes)
  if (handle.includes('n')) {
    let minDelta = threshold + 1;
    let snapY: number | null = null;
    let bestGuide: GuideLine | null = null;
    for (const target of horizontalTargets) {
      const d = Math.abs(y - target.pos);
      if (d < minDelta && d <= threshold) {
        minDelta = d;
        snapY = target.pos;
        bestGuide = { type: 'horizontal', position: target.pos, isCenter: target.isCenter };
      }
    }
    if (snapY !== null && bestGuide) {
      const bottom = y + h;
      const newY = Math.max(0, snapY);
      const newH = bottom - newY;
      if (newH >= 20) {
        y = newY;
        h = newH;
        guides.push(bestGuide);
      }
    }
  }

  // Handle South edge snapping (y fixed, h changes)
  if (handle.includes('s')) {
    const bottom = y + h;
    let minDelta = threshold + 1;
    let snapBottom: number | null = null;
    let bestGuide: GuideLine | null = null;
    for (const target of horizontalTargets) {
      const d = Math.abs(bottom - target.pos);
      if (d < minDelta && d <= threshold) {
        minDelta = d;
        snapBottom = target.pos;
        bestGuide = { type: 'horizontal', position: target.pos, isCenter: target.isCenter };
      }
    }
    if (snapBottom !== null && bestGuide) {
      const newBottom = Math.min(templateHeight, snapBottom);
      const newH = newBottom - y;
      if (newH >= 20) {
        h = newH;
        guides.push(bestGuide);
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
