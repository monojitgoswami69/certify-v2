import { describe, expect, it } from 'vitest';
import { calculateMoveSnapping, calculateResizeSnapping } from './canvas-snapping';
import type { ImageElement, TextBox } from '../types';
import type { QrZone } from '../store/useAppStore';

const makeBox = (id: string, x: number, y: number, w: number, h: number): TextBox => ({
  id,
  field: id,
  x,
  y,
  w,
  h,
  fontSize: 28,
  fontColor: '#111827',
  fontFamily: 'Inter',
  hAlign: 'center',
  vAlign: 'middle',
});

describe('canvas-snapping', () => {
  it('snaps moving elements to canvas centers, siblings, QR zones, and decorative images', () => {
    const sibling = makeBox('sibling', 100, 100, 200, 60);
    const qr: QrZone = { id: 'qr_1', x: 700, y: 120, size: 100 };
    const image: ImageElement = { id: 'img_1', x: 250, y: 400, w: 120, h: 80, src: 'data:image/png;base64,iVBORw0KGgo=' };

    // Center X of moving element (497 + 100/2 = 547 -> snaps to 500? Wait: 1000/2 = 500, let x=453 -> center 503 within 8px of 500)
    const centerSnap = calculateMoveSnapping(
      { id: 'moving', x: 454, y: 103, w: 100, h: 40 },
      1000,
      800,
      [sibling],
      [qr],
      false,
      8,
      [image]
    );
    expect(centerSnap.x).toBe(450); // centered at x=500
    expect(centerSnap.y).toBe(100); // top edge aligned to sibling top
    expect(centerSnap.guides.some((g) => g.type === 'vertical' && g.position === 500 && g.isCenter)).toBe(true);
    expect(centerSnap.guides.some((g) => g.type === 'horizontal' && g.position === 100 && !g.isCenter)).toBe(true);

    // Snaps to decorative image left edge (250) and QR bottom (220)
    const elementSnap = calculateMoveSnapping(
      { id: 'moving', x: 255, y: 216, w: 80, h: 50 },
      1000,
      800,
      [sibling],
      [qr],
      false,
      8,
      [image]
    );
    expect(elementSnap.x).toBe(250);
    expect(elementSnap.y).toBe(220);
  });

  it('excludes itself from snap targets and enforces configurable minSize on resize', () => {
    const img: ImageElement = { id: 'self', x: 200, y: 200, w: 100, h: 100, src: 'data:image/png;base64,iVBORw0KGgo=' };
    const guideTarget = makeBox('target', 190, 298, 200, 50);

    // Resizing west handle near target x=190 snaps cleanly while anchoring right edge at 300
    const westResize = calculateResizeSnapping(
      { id: 'self', x: 194, y: 200, w: 106, h: 100 },
      'nw',
      1000,
      800,
      [guideTarget],
      [],
      false,
      8,
      20,
      [img]
    );
    expect(westResize.x).toBe(190);
    expect(westResize.w).toBe(110);

    // Resizing east edge close to target left (x=190) would shrink width below minSize=80 and must be rejected
    const tinyReject = calculateResizeSnapping(
      { id: 'small', x: 140, y: 100, w: 46, h: 40 },
      'se',
      1000,
      800,
      [guideTarget],
      [],
      false,
      8,
      80,
      []
    );
    expect(tinyReject.w).toBe(46);
  });
});
