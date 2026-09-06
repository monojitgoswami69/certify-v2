import type { TextBox } from '../../types';
import type { QrZone } from '../../store/useAppStore';
import { isFontLoaded, loadGoogleFont, getFontFamilyCSS } from '../../lib/font-loader';
import type { HandleKey } from '../../lib/canvas-snapping';

export const HANDLE_SIZE = 8;
export const LABEL_HEIGHT = 20;
export const LABEL_PADDING = 6;
export const QR_MIN_SIZE = 40;

export function getHandlePositions(sel: { x: number; y: number; w: number; h: number }) {
  const mx = sel.x + sel.w / 2;
  const my = sel.y + sel.h / 2;
  return {
    nw: { x: sel.x, y: sel.y },
    n: { x: mx, y: sel.y },
    ne: { x: sel.x + sel.w, y: sel.y },
    e: { x: sel.x + sel.w, y: my },
    se: { x: sel.x + sel.w, y: sel.y + sel.h },
    s: { x: mx, y: sel.y + sel.h },
    sw: { x: sel.x, y: sel.y + sel.h },
    w: { x: sel.x, y: my },
  };
}

export function drawBoxOnCanvas(
  ctx: CanvasRenderingContext2D,
  box: TextBox | { id?: string; x: number; y: number; w: number; h: number; field?: string },
  isActive: boolean,
  effectiveScale: number,
  previewEnabled: boolean,
  fontPreview?: { boxId: string; fontFamily: string } | null,
  previewText?: string
) {
  const displayBox = {
    x: box.x * effectiveScale,
    y: box.y * effectiveScale,
    w: box.w * effectiveScale,
    h: box.h * effectiveScale,
  };

  ctx.fillStyle = isActive ? 'rgba(79, 70, 229, 0.2)' : 'rgba(59, 130, 246, 0.12)';
  ctx.fillRect(displayBox.x, displayBox.y, displayBox.w, displayBox.h);

  ctx.strokeStyle = isActive ? '#4f46e5' : '#3b82f6';
  ctx.lineWidth = isActive ? 2 : 1.5;
  ctx.setLineDash(isActive ? [] : [4, 2]);
  ctx.strokeRect(displayBox.x, displayBox.y, displayBox.w, displayBox.h);
  ctx.setLineDash([]);

  const field = 'field' in box ? box.field : undefined;
  if (field) {
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const textMetrics = ctx.measureText(field);
    const labelWidth = textMetrics.width + LABEL_PADDING * 2 + 4;
    const labelHeight = LABEL_HEIGHT + 4;

    ctx.fillStyle = isActive ? '#0f172a' : '#1e293b';
    ctx.beginPath();
    ctx.roundRect(displayBox.x, displayBox.y - labelHeight - 2, labelWidth, labelHeight, 4);
    ctx.fill();

    ctx.strokeStyle = isActive ? '#fbbf24' : '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = isActive ? '#fbbf24' : '#38bdf8';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(field, displayBox.x + LABEL_PADDING + 2, displayBox.y - labelHeight / 2 - 2);
  }

  if (previewEnabled && previewText && 'fontSize' in box) {
    let currentFontSize = box.fontSize;
    const minFontSize = 10;
    const previewFontFamily = fontPreview?.boxId === box.id ? fontPreview.fontFamily : null;
    const actualFontFamily = 'fontFamily' in box ? box.fontFamily : '';
    const useFontFamily = previewFontFamily || actualFontFamily;

    const fontFamily = useFontFamily ? getFontFamilyCSS(useFontFamily) : 'system-ui, sans-serif';

    if (useFontFamily && !isFontLoaded(useFontFamily)) {
      loadGoogleFont(useFontFamily);
    }

    while (currentFontSize >= minFontSize) {
      const displayFontSize = currentFontSize * effectiveScale;
      ctx.font = `${displayFontSize}px ${fontFamily}`;
      const metrics = ctx.measureText(previewText);
      const textHeight = displayFontSize * 1.2;

      if (metrics.width <= displayBox.w - 10 && textHeight <= displayBox.h - 10) {
        break;
      }
      currentFontSize -= 2;
    }

    const displayFontSize = currentFontSize * effectiveScale;
    ctx.font = `${displayFontSize}px ${fontFamily}`;
    ctx.fillStyle = box.fontColor;

    const hAlign = 'hAlign' in box ? box.hAlign : 'center';
    const vAlign = 'vAlign' in box ? box.vAlign : 'bottom';

    let textX: number;
    if (hAlign === 'left') {
      ctx.textAlign = 'left';
      textX = displayBox.x + 5;
    } else if (hAlign === 'right') {
      ctx.textAlign = 'right';
      textX = displayBox.x + displayBox.w - 5;
    } else {
      ctx.textAlign = 'center';
      textX = displayBox.x + displayBox.w / 2;
    }

    let textY: number;
    ctx.textBaseline = 'alphabetic';
    if (vAlign === 'top') {
      textY = displayBox.y + displayFontSize;
    } else if (vAlign === 'middle') {
      textY = displayBox.y + (displayBox.h + displayFontSize) / 2 - 2;
    } else {
      textY = displayBox.y + displayBox.h - 8;
    }

    ctx.fillText(previewText, textX, textY);
  }

  if (isActive) {
    const handles = getHandlePositions(displayBox);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;

    Object.values(handles).forEach((h) => {
      ctx.beginPath();
      ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    });
  }
}

export function drawQrZonesOnCanvas(
  ctx: CanvasRenderingContext2D,
  qrZones: QrZone[],
  activeQrId: string | null,
  placeholderImg: HTMLImageElement | null,
  isPlacingQr: boolean,
  qrGhostPos: { x: number; y: number } | null,
  templateImage: HTMLImageElement | null,
  effectiveScale: number
) {
  qrZones.forEach((zone, index) => {
    const isActive = activeQrId === zone.id;
    const dx = zone.x * effectiveScale;
    const dy = zone.y * effectiveScale;
    const ds = zone.size * effectiveScale;

    ctx.save();

    if (isActive) {
      ctx.fillStyle = 'rgba(139, 92, 246, 0.08)';
      ctx.fillRect(dx, dy, ds, ds);
    }

    if (placeholderImg && placeholderImg.complete && placeholderImg.naturalWidth > 0) {
      ctx.drawImage(placeholderImg, dx, dy, ds, ds);
    }

    ctx.strokeStyle = isActive ? '#7c3aed' : '#a78bfa';
    ctx.lineWidth = isActive ? 2 : 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(dx, dy, ds, ds);
    ctx.setLineDash([]);

    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const label = qrZones.length > 1 ? `QR ${index + 1}` : 'QR Verification';
    const metrics = ctx.measureText(label);
    const labelWidth = metrics.width + LABEL_PADDING * 2 + 4;
    const labelHeight = LABEL_HEIGHT + 4;

    ctx.fillStyle = isActive ? '#4c1d95' : '#5b21b6';
    ctx.beginPath();
    ctx.roundRect(dx, dy - labelHeight - 2, labelWidth, labelHeight, 4);
    ctx.fill();
    ctx.fillStyle = isActive ? '#ddd6fe' : '#ede9fe';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, dx + LABEL_PADDING + 2, dy - labelHeight / 2 - 2);

    if (isActive) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(
        dx + ds - HANDLE_SIZE / 2,
        dy + ds - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE
      );
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  });

  // Ghost preview when hovering in click-to-place QR mode
  if (isPlacingQr && qrGhostPos && templateImage) {
    const defaultSize =
      Math.round(Math.min(templateImage.width, templateImage.height) * 0.15) || 180;
    const gx =
      Math.max(
        0,
        Math.min(qrGhostPos.x - defaultSize / 2, templateImage.width - defaultSize)
      ) * effectiveScale;
    const gy =
      Math.max(
        0,
        Math.min(qrGhostPos.y - defaultSize / 2, templateImage.height - defaultSize)
      ) * effectiveScale;
    const gs = defaultSize * effectiveScale;

    ctx.save();
    ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
    ctx.fillRect(gx, gy, gs, gs);

    if (placeholderImg && placeholderImg.complete && placeholderImg.naturalWidth > 0) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(placeholderImg, gx, gy, gs, gs);
      ctx.globalAlpha = 1.0;
    }

    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(gx, gy, gs, gs);
    ctx.setLineDash([]);

    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const label = 'Click to Place QR';
    const metrics = ctx.measureText(label);
    const labelWidth = metrics.width + 16;
    const labelHeight = 22;

    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.roundRect(gx, gy - labelHeight - 2, labelWidth, labelHeight, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, gx + 8, gy - labelHeight / 2 - 2);

    ctx.restore();
  }
}

export function getHandleAtPoint(
  imgX: number,
  imgY: number,
  activeBox: TextBox | undefined,
  effectiveScale: number
): HandleKey | null {
  if (!activeBox) return null;

  const handles = getHandlePositions(activeBox);
  const threshold = (HANDLE_SIZE * 1.5) / effectiveScale;

  for (const [key, pos] of Object.entries(handles)) {
    if (Math.abs(imgX - pos.x) < threshold && Math.abs(imgY - pos.y) < threshold) {
      return key as HandleKey;
    }
  }
  return null;
}

export function getBoxAtPoint(
  imgX: number,
  imgY: number,
  boxes: TextBox[]
): TextBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (imgX >= box.x && imgX <= box.x + box.w && imgY >= box.y && imgY <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

export function getQrZoneAtPoint(
  imgX: number,
  imgY: number,
  qrZones: QrZone[]
): QrZone | null {
  for (let i = qrZones.length - 1; i >= 0; i--) {
    const zone = qrZones[i];
    if (
      imgX >= zone.x &&
      imgX <= zone.x + zone.size &&
      imgY >= zone.y &&
      imgY <= zone.y + zone.size
    ) {
      return zone;
    }
  }
  return null;
}

export function getQrResizeHandleAtPoint(
  imgX: number,
  imgY: number,
  activeZone: QrZone | undefined,
  effectiveScale: number
): QrZone | null {
  if (!activeZone) return null;
  const threshold = (HANDLE_SIZE * 1.5) / effectiveScale;
  if (
    Math.abs(imgX - (activeZone.x + activeZone.size)) < threshold &&
    Math.abs(imgY - (activeZone.y + activeZone.size)) < threshold
  ) {
    return activeZone;
  }
  return null;
}
