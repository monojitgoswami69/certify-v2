'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import QRCode from 'qrcode';
import {
  RotateCcw,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronUp,
} from 'lucide-react';
import { useAppStore, type QrZone } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { isFontLoaded, loadGoogleFont, getFontFamilyCSS } from '../../lib/font-loader';
import {
  calculateMoveSnapping,
  calculateResizeSnapping,
  drawGuideLines,
  type GuideLine,
  type HandleKey,
} from '../../lib/canvas-snapping';
import type { TextBox } from '../../types';

const HANDLE_SIZE = 8;
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 6;
const QR_MIN_SIZE = 40;

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;

type DragMode = 'none' | 'draw' | 'move' | 'resize' | 'qr-move' | 'qr-resize' | 'pan';

export function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  const {
    templateImage,
    boxes,
    activeBoxId,
    previewEnabled,
    csvData,
    fontPreview,
    qrZones,
    activeQrId,
    isPlacingQr,
    addBox,
    updateBox,
    deleteBox,
    setActiveBox,
    setBoxes,
    addQrZone,
    updateQrZone,
    deleteQrZone,
    setActiveQrId,
    setIsPlacingQr,
    setQrZones,
    reset,
  } = useAppStore();

  const { past, future, pushState, undo, redo, clearHistory } = useHistoryStore();

  // Viewport zoom & pan state
  const [baseFitScale, setBaseFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);

  // Drag interaction state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panDragStart, setPanDragStart] = useState({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = useState({ x: 0, y: 0 });
  const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
  const [originalBox, setOriginalBox] = useState<TextBox | null>(null);
  const [tempBox, setTempBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [originalQrZone, setOriginalQrZone] = useState<QrZone | null>(null);
  const [qrGhostPos, setQrGhostPos] = useState<{ x: number; y: number } | null>(null);

  // Total effective display scale = baseFitScale * zoom
  const effectiveScale = baseFitScale * zoom;

  // Placeholder QR shown inside the zone while designing
  const placeholderImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL('CREDIFY-VERIFY-PLACEHOLDER', {
      margin: 1,
      width: 512,
      color: {
        dark: '#000000',
        light: '#00000000', // 100% Transparent background
      },
    })
      .then((url) => {
        if (cancelled) return;
        const img = new Image();
        img.onload = () => {
          placeholderImgRef.current = img;
        };
        img.src = url;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Smart high-contrast border detection based on template edge luminance
  const [adaptiveBorder, setAdaptiveBorder] = useState<{
    borderColor: string;
    outerRing: string;
    shadow: string;
  }>({
    borderColor: '#1e293b',
    outerRing: 'rgba(15, 23, 42, 0.2)',
    shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
  });

  useEffect(() => {
    if (!templateImage) return;

    try {
      const offscreen = document.createElement('canvas');
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const size = 64;
      offscreen.width = size;
      offscreen.height = size;
      ctx.drawImage(templateImage, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size).data;
      let totalLum = 0;
      let count = 0;

      // Sample 3px outer perimeter
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          if (x < 3 || x >= size - 3 || y < 3 || y >= size - 3) {
            const idx = (y * size + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            if (a > 30) {
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              totalLum += lum;
              count++;
            }
          }
        }
      }

      const avgLum = count > 0 ? totalLum / count : 255;

      if (avgLum > 140) {
        // Light edge (white, cream, pale yellow): bold dark slate border
        setAdaptiveBorder({
          borderColor: '#1e293b',
          outerRing: 'rgba(15, 23, 42, 0.2)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
        });
      } else if (avgLum < 90) {
        // Dark edge (black, deep navy, dark brown): bold illuminated white border
        setAdaptiveBorder({
          borderColor: '#ffffff',
          outerRing: 'rgba(255, 255, 255, 0.4)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65), 0 0 25px rgba(255, 255, 255, 0.25)',
        });
      } else {
        // Mid-tone & colorful edges (teal, orange, purple, green): dual high-contrast border
        setAdaptiveBorder({
          borderColor: '#0f172a',
          outerRing: 'rgba(255, 255, 255, 0.95)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.45)',
        });
      }
    } catch {
      // Fallback
    }
  }, [templateImage]);

  // Screen coordinates to image coordinates
  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (screenX - rect.left) / effectiveScale,
        y: (screenY - rect.top) / effectiveScale,
      };
    },
    [effectiveScale]
  );

  // Calculate base scale to fit the template in the container
  const fitImageToCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container || !templateImage) return;

    const containerRect = container.getBoundingClientRect();
    const padding = 48;

    const availableWidth = Math.max(100, containerRect.width - padding * 2);
    const availableHeight = Math.max(100, containerRect.height - padding * 2);

    const scaleX = availableWidth / templateImage.width;
    const scaleY = availableHeight / templateImage.height;
    const fitScale = Math.min(scaleX, scaleY, 1);

    setBaseFitScale(fitScale);
  }, [templateImage]);

  // Reset to initial Fit view
  const handleResetFit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsZoomMenuOpen(false);
    fitImageToCanvas();
  }, [fitImageToCanvas]);

  // Handle Zoom change
  const handleZoomChange = useCallback(
    (newZoom: number, originScreenPoint?: { x: number; y: number }) => {
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (clampedZoom <= 1.0) {
        setZoom(clampedZoom);
        setPan({ x: 0, y: 0 }); // Center if fully visible
        return;
      }

      if (!originScreenPoint || !containerRef.current) {
        setZoom(clampedZoom);
        return;
      }

      // Smooth zoom centered on mouse cursor
      const containerRect = containerRef.current.getBoundingClientRect();
      const mouseOffset = {
        x: originScreenPoint.x - (containerRect.left + containerRect.width / 2) - pan.x,
        y: originScreenPoint.y - (containerRect.top + containerRect.height / 2) - pan.y,
      };

      const scaleRatio = clampedZoom / zoom;
      const newPan = {
        x: pan.x - mouseOffset.x * (scaleRatio - 1),
        y: pan.y - mouseOffset.y * (scaleRatio - 1),
      };

      setZoom(clampedZoom);
      setPan(newPan);
    },
    [zoom, pan]
  );

  // Native wheel handler for smooth trackpad pan, shift scroll, and Ctrl/Cmd zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !templateImage) return;

    const handleWheel = (e: WheelEvent) => {
      // 1. Ctrl / Cmd + Wheel: Zoom in / out centered at mouse
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = -e.deltaY * 0.005;
        const targetZoom = zoom * (1 + zoomDelta);
        handleZoomChange(targetZoom, { x: e.clientX, y: e.clientY });
        return;
      }

      // 2. If zoom <= 1.0 (certificate is completely visible on screen), disable scrolling
      if (zoom <= 1.0) {
        return;
      }

      // 3. Zoom > 1.0: Scrolling is enabled
      e.preventDefault();

      const containerRect = container.getBoundingClientRect();
      const cssWidth = templateImage.width * effectiveScale;
      const cssHeight = templateImage.height * effectiveScale;

      const maxPanX = Math.max(0, (cssWidth - containerRect.width) / 2 + 100);
      const maxPanY = Math.max(0, (cssHeight - containerRect.height) / 2 + 100);

      if (e.shiftKey) {
        // Shift + vertical wheel -> horizontal scroll
        setPan((prev) => ({
          x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - e.deltaY)),
          y: prev.y,
        }));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal scroll from touchpad
        setPan((prev) => ({
          x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - e.deltaX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, prev.y - e.deltaY)),
        }));
      } else {
        // Normal vertical scroll
        setPan((prev) => ({
          x: prev.x,
          y: Math.max(-maxPanY, Math.min(maxPanY, prev.y - e.deltaY)),
        }));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom, effectiveScale, templateImage, handleZoomChange]);

  // Click outside listener for Zoom Dropdown Menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setIsZoomMenuOpen(false);
      }
    };
    if (isZoomMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isZoomMenuOpen]);

  // Window blur / Tab switch cleanup to prevent stuck Spacebar grab state
  useEffect(() => {
    const handleBlur = () => {
      setIsSpacePressed(false);
      document.body.style.cursor = '';
      if (canvasRef.current) {
        canvasRef.current.style.cursor = 'crosshair';
      }
    };

    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleBlur);
    };
  }, []);

  const getHandlePositions = (sel: { x: number; y: number; w: number; h: number }) => {
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
  };

  const drawBox = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      box: TextBox | { id?: string; x: number; y: number; w: number; h: number; field?: string },
      isActive: boolean,
      previewText?: string
    ) => {
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
        const textHeight = displayFontSize;

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
          textY = displayBox.y + textHeight;
        } else if (vAlign === 'middle') {
          textY = displayBox.y + (displayBox.h + textHeight) / 2 - 2;
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
    },
    [effectiveScale, previewEnabled, fontPreview]
  );

  const drawQrZones = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const placeholderImg = placeholderImgRef.current;

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
    },
    [qrZones, activeQrId, isPlacingQr, qrGhostPos, templateImage, effectiveScale]
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !templateImage) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = Math.floor(templateImage.width * effectiveScale);
    const cssHeight = Math.floor(templateImage.height * effectiveScale);

    if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.drawImage(templateImage, 0, 0, cssWidth, cssHeight);

    // Render active smart alignment guide lines BEHIND boxes and QR zones
    if (activeGuides.length > 0) {
      drawGuideLines(ctx, activeGuides, effectiveScale, cssWidth, cssHeight);
    }

    boxes.forEach((box) => {
      if (box.id !== activeBoxId) {
        const previewText = csvData.length > 0 && box.field ? csvData[0][box.field] : undefined;
        drawBox(ctx, box, false, previewText);
      }
    });

    const activeBox = boxes.find((b) => b.id === activeBoxId);
    if (activeBox) {
      const previewText =
        csvData.length > 0 && activeBox.field ? csvData[0][activeBox.field] : undefined;
      drawBox(ctx, activeBox, true, previewText);
    }

    if (tempBox && dragMode === 'draw') {
      drawBox(ctx, tempBox, true);
    }

    drawQrZones(ctx);

    ctx.restore();
  }, [
    templateImage,
    boxes,
    activeBoxId,
    csvData,
    drawBox,
    drawQrZones,
    tempBox,
    dragMode,
    activeGuides,
    effectiveScale,
  ]);

  const getHandleAtPoint = useCallback(
    (imgX: number, imgY: number): HandleKey | null => {
      const activeBox = boxes.find((b) => b.id === activeBoxId);
      if (!activeBox) return null;

      const handles = getHandlePositions(activeBox);
      const threshold = (HANDLE_SIZE * 1.5) / effectiveScale;

      for (const [key, pos] of Object.entries(handles)) {
        if (Math.abs(imgX - pos.x) < threshold && Math.abs(imgY - pos.y) < threshold) {
          return key as HandleKey;
        }
      }
      return null;
    },
    [boxes, activeBoxId, effectiveScale]
  );

  const getBoxAtPoint = useCallback(
    (imgX: number, imgY: number): TextBox | null => {
      for (let i = boxes.length - 1; i >= 0; i--) {
        const box = boxes[i];
        if (imgX >= box.x && imgX <= box.x + box.w && imgY >= box.y && imgY <= box.y + box.h) {
          return box;
        }
      }
      return null;
    },
    [boxes]
  );

  const getQrZoneAtPoint = useCallback(
    (imgX: number, imgY: number): QrZone | null => {
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
    },
    [qrZones]
  );

  const getQrResizeHandleAtPoint = useCallback(
    (imgX: number, imgY: number): QrZone | null => {
      const activeZone = qrZones.find((z) => z.id === activeQrId);
      if (!activeZone) return null;
      const threshold = (HANDLE_SIZE * 1.5) / effectiveScale;
      if (
        Math.abs(imgX - (activeZone.x + activeZone.size)) < threshold &&
        Math.abs(imgY - (activeZone.y + activeZone.size)) < threshold
      ) {
        return activeZone;
      }
      return null;
    },
    [qrZones, activeQrId, effectiveScale]
  );

  // Background container mouse down (Pan mode & workspace background click)
  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Handle Pan mode activation (Middle click or Spacebar held)
      if (e.button === 1 || isSpacePressed) {
        setDragMode('pan');
        setPanDragStart({ x: e.clientX, y: e.clientY });
        setPanOrigin({ ...pan });
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        return;
      }

      // Left click on workspace background outside certificate canvas: Deselect active elements
      if (e.target === containerRef.current) {
        setActiveBox(null);
        setActiveQrId(null);
      }
    },
    [isSpacePressed, pan, setActiveBox, setActiveQrId]
  );

  // Canvas element mouse down (Strict bounds, elements & box drawing)
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!templateImage) return;

      // Handle Pan mode activation (Middle click or Spacebar held)
      if (e.button === 1 || isSpacePressed) {
        setDragMode('pan');
        setPanDragStart({ x: e.clientX, y: e.clientY });
        setPanOrigin({ ...pan });
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        return;
      }

      if (e.button !== 0) return; // Only left click for editing

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

      // Strict Image Bounds Check: ignore out of bounds clicks
      if (imgX < 0 || imgX > templateImage.width || imgY < 0 || imgY > templateImage.height) {
        setActiveBox(null);
        setActiveQrId(null);
        return;
      }

      // QR Placement Mode: Click anywhere on certificate to drop new QR code
      if (isPlacingQr) {
        const defaultSize =
          Math.round(Math.min(templateImage.width, templateImage.height) * 0.15) || 180;
        const targetX = Math.max(
          0,
          Math.min(imgX - defaultSize / 2, templateImage.width - defaultSize)
        );
        const targetY = Math.max(
          0,
          Math.min(imgY - defaultSize / 2, templateImage.height - defaultSize)
        );
        pushState(boxes, qrZones);
        addQrZone(targetX, targetY, defaultSize);
        setIsPlacingQr(false);
        setQrGhostPos(null);
        return;
      }

      const handle = getHandleAtPoint(imgX, imgY);
      if (handle) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          pushState(boxes, qrZones);
          setDragMode('resize');
          setActiveHandle(handle);
          setOriginalBox({ ...activeBox });
          setDragStart({ x: imgX, y: imgY });
          return;
        }
      }

      const clickedBox = getBoxAtPoint(imgX, imgY);
      if (clickedBox) {
        if (clickedBox.id === activeBoxId) {
          pushState(boxes, qrZones);
          setDragMode('move');
          setDragStart({ x: imgX, y: imgY });
          setOriginalBox({ ...clickedBox });
        } else {
          setActiveBox(clickedBox.id);
          setActiveQrId(null);
        }
        return;
      }

      // QR Zone resize handle hit test
      const qrResizeHandle = getQrResizeHandleAtPoint(imgX, imgY);
      if (qrResizeHandle) {
        pushState(boxes, qrZones);
        setDragMode('qr-resize');
        setDragStart({ x: imgX, y: imgY });
        setOriginalQrZone({ ...qrResizeHandle });
        return;
      }

      // QR Zone body hit test
      const clickedQr = getQrZoneAtPoint(imgX, imgY);
      if (clickedQr) {
        if (clickedQr.id === activeQrId) {
          pushState(boxes, qrZones);
          setDragMode('qr-move');
          setDragStart({ x: imgX, y: imgY });
          setOriginalQrZone({ ...clickedQr });
        } else {
          setActiveQrId(clickedQr.id);
          setActiveBox(null);
        }
        return;
      }

      // Start drawing a new box strictly within certificate boundaries
      setActiveQrId(null);
      setActiveBox(null);
      setDragMode('draw');
      setDragStart({ x: imgX, y: imgY });
      setTempBox({ x: imgX, y: imgY, w: 0, h: 0 });
    },
    [
      templateImage,
      isSpacePressed,
      isPlacingQr,
      pan,
      screenToImage,
      getHandleAtPoint,
      getBoxAtPoint,
      boxes,
      activeBoxId,
      setActiveBox,
      pushState,
      qrZones,
      activeQrId,
      getQrResizeHandleAtPoint,
      getQrZoneAtPoint,
      setActiveQrId,
      addQrZone,
      setIsPlacingQr,
    ]
  );

  // Window-level mouse move & mouse up for rock-solid dragging / drawing
  useEffect(() => {
    if (dragMode === 'none') return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!templateImage) return;

      if (dragMode === 'pan') {
        const dx = e.clientX - panDragStart.x;
        const dy = e.clientY - panDragStart.y;
        setPan({
          x: panOrigin.x + dx,
          y: panOrigin.y + dy,
        });
        return;
      }

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);
      const clampedX = Math.max(0, Math.min(imgX, templateImage.width));
      const clampedY = Math.max(0, Math.min(imgY, templateImage.height));

      if (dragMode === 'draw') {
        const x = Math.min(dragStart.x, clampedX);
        const y = Math.min(dragStart.y, clampedY);
        const w = Math.abs(clampedX - dragStart.x);
        const h = Math.abs(clampedY - dragStart.y);
        setTempBox({ x, y, w, h });
      } else if (dragMode === 'move' && originalBox) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        let targetX = originalBox.x + dx;
        let targetY = originalBox.y + dy;
        targetX = Math.max(0, Math.min(targetX, templateImage.width - originalBox.w));
        targetY = Math.max(0, Math.min(targetY, templateImage.height - originalBox.h));

        // Always-on Magnetic Alignment Snapping (Hold Alt to bypass)
        if (!e.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: originalBox.w, h: originalBox.h, id: originalBox.id },
            templateImage.width,
            templateImage.height,
            boxes,
            qrZones,
            false,
            8 / zoom
          );
          updateBox(originalBox.id, { x: snap.x, y: snap.y });
          setActiveGuides(snap.guides);
        } else {
          updateBox(originalBox.id, { x: targetX, y: targetY });
          setActiveGuides([]);
        }
      } else if (dragMode === 'resize' && activeHandle && originalBox) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const rawBox = { ...originalBox };

        if (activeHandle.includes('w')) {
          rawBox.x = originalBox.x + dx;
          rawBox.w = originalBox.w - dx;
        }
        if (activeHandle.includes('e')) {
          rawBox.w = originalBox.w + dx;
        }
        if (activeHandle.includes('n')) {
          rawBox.y = originalBox.y + dy;
          rawBox.h = originalBox.h - dy;
        }
        if (activeHandle.includes('s')) {
          rawBox.h = originalBox.h + dy;
        }

        if (!e.altKey) {
          const snap = calculateResizeSnapping(
            rawBox,
            activeHandle,
            templateImage.width,
            templateImage.height,
            boxes,
            qrZones,
            false,
            8 / zoom
          );
          updateBox(originalBox.id, { x: snap.x, y: snap.y, w: snap.w, h: snap.h });
          setActiveGuides(snap.guides);
        } else {
          updateBox(originalBox.id, {
            x: rawBox.x,
            y: rawBox.y,
            w: Math.max(20, rawBox.w),
            h: Math.max(20, rawBox.h),
          });
          setActiveGuides([]);
        }
      } else if (dragMode === 'qr-move' && originalQrZone) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const newSize = originalQrZone.size;
        let targetX = Math.max(0, Math.min(originalQrZone.x + dx, templateImage.width - newSize));
        let targetY = Math.max(0, Math.min(originalQrZone.y + dy, templateImage.height - newSize));

        if (!e.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: newSize, h: newSize, id: originalQrZone.id },
            templateImage.width,
            templateImage.height,
            boxes,
            qrZones,
            true,
            8 / zoom
          );
          updateQrZone(originalQrZone.id, { x: snap.x, y: snap.y });
          setActiveGuides(snap.guides);
        } else {
          updateQrZone(originalQrZone.id, { x: targetX, y: targetY });
          setActiveGuides([]);
        }
      } else if (dragMode === 'qr-resize' && originalQrZone) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const rawSize = originalQrZone.size + Math.max(dx, dy);
        const maxSize = Math.min(
          templateImage.width - originalQrZone.x,
          templateImage.height - originalQrZone.y
        );
        const newSize = Math.max(QR_MIN_SIZE, Math.min(rawSize, maxSize));
        updateQrZone(originalQrZone.id, { size: newSize });
      }
    };

    const handleWindowMouseUp = () => {
      if (dragMode === 'draw' && tempBox && tempBox.w > 15 && tempBox.h > 15) {
        pushState(boxes, qrZones);
        addBox(tempBox);
      }
      setDragMode('none');
      setActiveHandle(null);
      setOriginalBox(null);
      setOriginalQrZone(null);
      setTempBox(null);
      setActiveGuides([]);
      document.body.style.cursor = '';
      if (canvasRef.current) {
        canvasRef.current.style.cursor = isSpacePressed ? 'grab' : isPlacingQr ? 'crosshair' : 'crosshair';
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [
    dragMode,
    panDragStart,
    panOrigin,
    dragStart,
    originalBox,
    activeHandle,
    originalQrZone,
    zoom,
    boxes,
    qrZones,
    isPlacingQr,
    screenToImage,
    updateBox,
    updateQrZone,
    templateImage,
    tempBox,
    addBox,
    pushState,
  ]);

  // Hover cursor styling when not dragging
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragMode !== 'none' || !templateImage) return;

      if (isSpacePressed) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        return;
      }

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

      if (isPlacingQr) {
        setQrGhostPos({ x: imgX, y: imgY });
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      } else if (qrGhostPos) {
        setQrGhostPos(null);
      }

      if (getQrResizeHandleAtPoint(imgX, imgY)) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'nwse-resize';
        return;
      }
      const qrAtPoint = getQrZoneAtPoint(imgX, imgY);
      if (qrAtPoint) {
        if (canvasRef.current) {
          canvasRef.current.style.cursor = qrAtPoint.id === activeQrId ? 'move' : 'pointer';
        }
        return;
      }

      const handle = getHandleAtPoint(imgX, imgY);
      if (handle && canvasRef.current) {
        const cursorStyle = {
          nw: 'nwse-resize',
          n: 'ns-resize',
          ne: 'nesw-resize',
          e: 'ew-resize',
          se: 'nwse-resize',
          s: 'ns-resize',
          sw: 'nesw-resize',
          w: 'ew-resize',
        }[handle];
        canvasRef.current.style.cursor = cursorStyle;
        return;
      }

      const box = getBoxAtPoint(imgX, imgY);
      if (box && canvasRef.current) {
        canvasRef.current.style.cursor = 'move';
        return;
      }

      if (canvasRef.current) {
        canvasRef.current.style.cursor = 'crosshair';
      }
    },
    [
      dragMode,
      templateImage,
      isSpacePressed,
      isPlacingQr,
      qrGhostPos,
      screenToImage,
      activeQrId,
      getQrResizeHandleAtPoint,
      getQrZoneAtPoint,
      getHandleAtPoint,
      getBoxAtPoint,
    ]
  );

  // Global Keyboard Shortcuts (Nudging, Zooming, Spacebar, Undo/Redo, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return;
      }

      // Spacebar hold for Pan
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = 'grab';
        }
      }

      // Zoom Shortcuts: Cmd/Ctrl + + / - / 0
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomChange(zoom + 0.25);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleZoomChange(zoom - 0.25);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        handleResetFit();
        return;
      }

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          const snapshot = redo(boxes, qrZones);
          if (snapshot) {
            setBoxes(snapshot.boxes);
            setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
          }
        } else {
          const snapshot = undo(boxes, qrZones);
          if (snapshot) {
            setBoxes(snapshot.boxes);
            setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
          }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const snapshot = redo(boxes, qrZones);
        if (snapshot) {
          setBoxes(snapshot.boxes);
          setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
        }
        return;
      }

      // Delete Active Box
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeBoxId) {
        e.preventDefault();
        pushState(boxes, qrZones);
        deleteBox(activeBoxId);
        return;
      }

      // Delete Active QR Zone
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeQrId) {
        e.preventDefault();
        pushState(boxes, qrZones);
        deleteQrZone(activeQrId);
        return;
      }

      // Nudging with arrow keys
      const step = e.shiftKey ? 10 : 1;
      if (activeBoxId) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;
          if (e.key === 'ArrowUp') dy = -step;
          if (e.key === 'ArrowDown') dy = step;
          if (dx !== 0 || dy !== 0) {
            e.preventDefault();
            pushState(boxes, qrZones);
            updateBox(activeBoxId, {
              x: Math.max(0, Math.min(activeBox.x + dx, templateImage ? templateImage.width - activeBox.w : activeBox.x)),
              y: Math.max(0, Math.min(activeBox.y + dy, templateImage ? templateImage.height - activeBox.h : activeBox.y)),
            });
            return;
          }
        }
      }

      if (activeQrId) {
        const activeQr = qrZones.find((z) => z.id === activeQrId);
        if (activeQr) {
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;
          if (e.key === 'ArrowUp') dy = -step;
          if (e.key === 'ArrowDown') dy = step;
          if (dx !== 0 || dy !== 0) {
            e.preventDefault();
            pushState(boxes, qrZones);
            updateQrZone(activeQrId, {
              x: Math.max(0, Math.min(activeQr.x + dx, templateImage ? templateImage.width - activeQr.size : activeQr.x)),
              y: Math.max(0, Math.min(activeQr.y + dy, templateImage ? templateImage.height - activeQr.size : activeQr.y)),
            });
            return;
          }
        }
      }

      // Escape: Deselect all & cancel placement mode
      if (e.key === 'Escape') {
        setActiveBox(null);
        setActiveQrId(null);
        setIsPlacingQr(false);
        setIsZoomMenuOpen(false);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        document.body.style.cursor = '';
        if (canvasRef.current) {
          canvasRef.current.style.cursor = isPlacingQr ? 'crosshair' : 'crosshair';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    boxes,
    qrZones,
    activeBoxId,
    activeQrId,
    templateImage,
    zoom,
    isPlacingQr,
    undo,
    redo,
    pushState,
    deleteBox,
    deleteQrZone,
    updateBox,
    updateQrZone,
    setBoxes,
    setQrZones,
    setActiveBox,
    setActiveQrId,
    setIsPlacingQr,
    handleZoomChange,
    handleResetFit,
  ]);

  // ResizeObserver on container to automatically re-fit canvas when sidebar is resized
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      fitImageToCanvas();
    });

    resizeObserver.observe(container);
    fitImageToCanvas();

    return () => {
      resizeObserver.disconnect();
    };
  }, [fitImageToCanvas]);

  useEffect(() => {
    render();
  }, [render]);

  const activeBox = boxes.find((b) => b.id === activeBoxId);

  if (!templateImage) {
    return (
      <div ref={containerRef} className="flex-1 flex items-center justify-center bg-slate-100 p-6">
        <div className="text-center p-12 bg-white rounded-2xl border-2 border-dashed border-slate-300 shadow-sm max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 text-slate-300 flex items-center justify-center bg-slate-50 rounded-2xl">
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-700 text-lg mb-1">No Template Uploaded</h3>
          <p className="text-sm text-slate-500">
            Upload a certificate template on the left panel to begin layout design.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleContainerMouseDown}
      className={`flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative select-none ${
        isSpacePressed ? (dragMode === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      style={{
        backgroundColor: '#e6ebf2',
        backgroundImage: `
          linear-gradient(to right, rgba(100, 116, 139, 0.2) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(100, 116, 139, 0.2) 1px, transparent 1px)
        `,
        backgroundSize: '14px 14px',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Pannable Canvas Container (No CSS transitions for instantaneous, glitch-free dragging) */}
      <div
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="bg-white block"
          style={{
            outline: `3px solid ${adaptiveBorder.borderColor}`,
            outlineOffset: '0px',
            boxShadow: `
              0 0 0 4px ${adaptiveBorder.outerRing},
              ${adaptiveBorder.shadow}
            `,
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          tabIndex={0}
        />
      </div>

      {/* Floating Modern Studio Toolbar HUD (100% Solid & High-Contrast) */}
      <div className="absolute bottom-6 flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl shadow-2xl border border-slate-300/90 ring-1 ring-slate-900/10 text-slate-800 text-xs font-medium z-30">
        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const snapshot = undo(boxes, qrZones);
              if (snapshot) {
                setBoxes(snapshot.boxes);
                setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
              }
            }}
            disabled={past.length === 0}
            className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const snapshot = redo(boxes, qrZones);
              if (snapshot) {
                setBoxes(snapshot.boxes);
                setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
              }
            }}
            disabled={future.length === 0}
            className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <div className="w-px h-5 bg-slate-300" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleZoomChange(zoom - 0.25)}
            disabled={zoom <= MIN_ZOOM}
            className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
            title="Zoom Out (Ctrl+-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          {/* Zoom Preset Selector Dropdown */}
          <div className="relative" ref={zoomMenuRef}>
            <button
              onClick={() => setIsZoomMenuOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 rounded-lg text-slate-800 font-bold min-w-[62px] justify-center font-mono transition-colors"
              title="Click to select Zoom level"
            >
              <span>{Math.round(zoom * 100)}%</span>
              <ChevronUp
                className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isZoomMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isZoomMenuOpen && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col bg-white border border-slate-300 rounded-xl shadow-2xl py-1.5 w-32 text-center z-50">
                <button
                  onClick={handleResetFit}
                  className="px-3 py-1.5 hover:bg-violet-50 hover:text-violet-700 text-left text-xs font-semibold text-slate-700 transition-colors"
                >
                  Fit Screen
                </button>
                <div className="h-px bg-slate-200 my-1" />
                {ZOOM_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      handleZoomChange(preset);
                      setIsZoomMenuOpen(false);
                    }}
                    className={`px-3 py-1.5 hover:bg-violet-50 hover:text-violet-700 text-left text-xs font-mono transition-colors ${
                      Math.abs(zoom - preset) < 0.05
                        ? 'font-bold text-violet-700 bg-violet-50'
                        : 'text-slate-700 font-medium'
                    }`}
                  >
                    {Math.round(preset * 100)}%
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => handleZoomChange(zoom + 0.25)}
            disabled={zoom >= MAX_ZOOM}
            className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
            title="Zoom In (Ctrl++)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={handleResetFit}
            className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition-colors"
            title="Fit to Viewport (Ctrl+0)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-5 bg-slate-300" />

        {/* Reset Canvas Button */}
        <button
          onClick={() => {
            reset();
            clearHistory();
          }}
          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Reset Layout"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Active Element Coordinates Pill */}
        {(() => {
          const activeBox = boxes.find((b) => b.id === activeBoxId);
          const activeQr = qrZones.find((z) => z.id === activeQrId);
          if (activeBox) {
            return (
              <>
                <div className="w-px h-5 bg-slate-300" />
                <div className="text-xs text-slate-700 font-mono font-medium px-2 py-0.5 bg-slate-100 rounded-md border border-slate-200">
                  X:{Math.round(activeBox.x)} Y:{Math.round(activeBox.y)} · {Math.round(activeBox.w)}×{Math.round(activeBox.h)}
                </div>
              </>
            );
          }
          if (activeQr) {
            return (
              <>
                <div className="w-px h-5 bg-slate-300" />
                <div className="text-xs text-violet-700 font-mono font-semibold px-2 py-0.5 bg-violet-50 rounded-md border border-violet-200">
                  QR X:{Math.round(activeQr.x)} Y:{Math.round(activeQr.y)} · {Math.round(activeQr.size)}px
                </div>
              </>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}
