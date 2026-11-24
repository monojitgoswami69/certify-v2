'use client';

import React, { useRef, useEffect, useCallback, useState, useLayoutEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

import { useHistoryStore } from '../../store/useHistoryStore';
import {
  calculateMoveSnapping,
  calculateResizeSnapping,
  drawGuideLines,
  type GuideLine,
  type HandleKey,
} from '../../lib/canvas-snapping';
import type { TextBox, QrZone, ImageElement } from '../../types';
import { resolveFieldValue } from '../../lib/utils';
import { useAdaptiveBorder } from './useAdaptiveBorder';
import { useCanvasZoomPan } from './useCanvasZoomPan';
import {
  drawBoxOnCanvas,
  drawQrZonesOnCanvas,
  drawImageElementOnCanvas,
  getHandleAtPoint,
  getBoxAtPoint,
  getQrZoneAtPoint,
  getQrResizeHandleAtPoint,
  getImageElementAtPoint,
} from './canvas-renderer';
import { subscribeToQrImage } from '../../lib/qr-renderer';
import { clearTextMeasurements } from '../../lib/certificate-text';
import { getPreviewBackingSize } from './canvas-geometry';
import { CanvasToolbar } from './CanvasToolbar';

type DragMode = 'none' | 'draw' | 'move' | 'resize' | 'qr-move' | 'qr-resize' | 'img-move' | 'img-resize' | 'pan';

const MIN_DRAG_SIZE = 12;
type Bounds = Pick<TextBox, 'x' | 'y' | 'w' | 'h'>;

/**
 * Keeps a resized box inside the template, anchoring the edge
 * opposite the dragged handle so dragging past it cannot produce negative dimensions.
 */
function constrainResizedBox(
  box: Bounds,
  original: Bounds,
  handle: HandleKey,
  templateWidth: number,
  templateHeight: number,
  minimum: number
): Bounds {
  let { x, y, w, h } = box;

  if (handle.includes('w')) {
    const right = original.x + original.w;
    x = Math.max(0, Math.min(x, right - Math.min(right, minimum)));
    w = right - x;
  } else if (handle.includes('e')) {
    w = Math.min(templateWidth - original.x, Math.max(minimum, w));
    x = original.x;
  }

  if (handle.includes('n')) {
    const bottom = original.y + original.h;
    y = Math.max(0, Math.min(y, bottom - Math.min(bottom, minimum)));
    h = bottom - y;
  } else if (handle.includes('s')) {
    h = Math.min(templateHeight - original.y, Math.max(minimum, h));
    y = original.y;
  }

  return { x, y, w, h };
}

export function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const {
    images,
    activeImageId,
    addImage,
    updateImage,
    deleteImage,
    setActiveImage,
    setImages,
  } = useAppStore();

  const { past, future, pushState, undo, redo, clearHistory } = useHistoryStore();

  // Smart high-contrast border detection based on template edge luminance
  const adaptiveBorder = useAdaptiveBorder(templateImage);

  // Drag interaction state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const dragMovedRef = useRef(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panDragStart, setPanDragStart] = useState({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = useState({ x: 0, y: 0 });
  const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
  const [originalBox, setOriginalBox] = useState<TextBox | null>(null);
  const [tempBox, setTempBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [originalQrZone, setOriginalQrZone] = useState<{ id: string; x: number; y: number; size: number } | null>(null);
  const [qrGhostPos, setQrGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);
  const savedPreDragStateRef = useRef<{ boxes: TextBox[]; qrZones: QrZone[]; images: ImageElement[] } | null>(null);
  const [originalImage, setOriginalImage] = useState<ImageElement | null>(null);

  const snapPreDrag = (
    b: TextBox[],
    z: QrZone[],
    im: ImageElement[]
  ): { boxes: TextBox[]; qrZones: QrZone[]; images: ImageElement[] } => ({
    boxes: b,
    qrZones: z,
    images: im,
  });

  // Decoded image elements for on-canvas preview; keyed by src.
  const decodedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageVersion, bumpImageVersion] = useState(0);
  const ensureDecoded = useCallback((src: string): HTMLImageElement | null => {
    const cached = decodedImagesRef.current.get(src);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    const img = new Image();
    img.onload = () => bumpImageVersion((version) => version + 1);
    decodedImagesRef.current.set(src, img);
    img.src = src;
    return null;
  }, []);

  useEffect(() => {
    for (const src of decodedImagesRef.current.keys()) {
      if (!images.some((image) => image.src === src)) decodedImagesRef.current.delete(src);
    }
  }, [images]);

  // Undo / Redo / Delete callbacks
  const applySnapshot = useCallback(
    (snapshot: { boxes: TextBox[]; qrZones?: QrZone[]; images?: ImageElement[]; qrZone?: QrZone | null }) => {
      const nextQrZones = snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []);
      const nextImages = snapshot.images ?? useAppStore.getState().images;
      setBoxes(snapshot.boxes);
      setQrZones(nextQrZones);
      setImages(nextImages);
      // Drop selections that point at elements the snapshot no longer contains
      const state = useAppStore.getState();
      if (state.activeBoxId && !snapshot.boxes.some((b) => b.id === state.activeBoxId)) {
        state.setActiveBox(null);
      }
      if (state.activeQrId && !nextQrZones.some((z) => z.id === state.activeQrId)) {
        state.setActiveQrId(null);
      }
      if (state.activeImageId && !nextImages.some((el) => el.id === state.activeImageId)) {
        state.setActiveImage(null);
      }
    },
    [setBoxes, setQrZones, setImages]
  );

  const handleUndo = useCallback(() => {
    const snapshot = undo(boxes, qrZones, images);
    if (snapshot) applySnapshot(snapshot);
  }, [undo, boxes, qrZones, images, applySnapshot]);

  const handleRedo = useCallback(() => {
    const snapshot = redo(boxes, qrZones, images);
    if (snapshot) applySnapshot(snapshot);
  }, [redo, boxes, qrZones, images, applySnapshot]);

  const handleDeleteActive = useCallback(() => {
    if (activeBoxId) {
      pushState(boxes, qrZones);
      deleteBox(activeBoxId);
    } else if (activeQrId) {
      pushState(boxes, qrZones);
      deleteQrZone(activeQrId);
    } else if (activeImageId) {
      pushState(boxes, qrZones, images);
      deleteImage(activeImageId);
    }
  }, [activeBoxId, activeQrId, activeImageId, boxes, qrZones, images, pushState, deleteBox, deleteQrZone, deleteImage]);

  // A burst of nudges (held arrow key) is one undo step, not one per pixel
  const lastNudgeAtRef = useRef(0);
  const pushNudgeState = useCallback(() => {
    const now = Date.now();
    if (now - lastNudgeAtRef.current > 600) pushState(boxes, qrZones);
    lastNudgeAtRef.current = now;
  }, [pushState, boxes, qrZones]);

  const handleArrowNudge = useCallback(
    (dx: number, dy: number) => {
      if (activeBoxId) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          pushNudgeState();
          updateBox(activeBoxId, {
            x: Math.max(0, Math.min(activeBox.x + dx, templateImage ? templateImage.width - activeBox.w : activeBox.x)),
            y: Math.max(0, Math.min(activeBox.y + dy, templateImage ? templateImage.height - activeBox.h : activeBox.y)),
          });
        }
      } else if (activeQrId) {
        const activeQr = qrZones.find((z) => z.id === activeQrId);
        if (activeQr) {
          pushNudgeState();
          updateQrZone(activeQrId, {
            x: Math.max(0, Math.min(activeQr.x + dx, templateImage ? templateImage.width - activeQr.size : activeQr.x)),
            y: Math.max(0, Math.min(activeQr.y + dy, templateImage ? templateImage.height - activeQr.size : activeQr.y)),
          });
        }
      }
    },
    [activeBoxId, activeQrId, boxes, qrZones, pushNudgeState, updateBox, updateQrZone, templateImage]
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // Viewport Zoom, Pan & Keyboard controls
  const {
    zoom,
    pan,
    setPan,
    effectiveScale,
    isSpacePressed,
    isZoomMenuOpen,
    setIsZoomMenuOpen,
    zoomMenuRef,
    screenToImage,
    handleResetFit,
    handleZoomChange,
    fitImageToCanvas,
  } = useCanvasZoomPan({
    templateImage,
    containerRef,
    canvasRef,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDeleteActive: handleDeleteActive,
    onArrowNudge: handleArrowNudge,
    isDrawingEnabled: Boolean(templateImage),
    onEscape: () => {
      setActiveBox(null);
      setActiveQrId(null);
      setActiveImage(null);
      setIsPlacingQr(false);
      setIsZoomMenuOpen(false);
    },
  });

  // Main Canvas Rendering Loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !templateImage) return;

    const cssWidth = templateImage.width * effectiveScale;
    const cssHeight = templateImage.height * effectiveScale;
    const { width, height } = getPreviewBackingSize(cssWidth, cssHeight, window.devicePixelRatio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    ctx.save();
    ctx.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.drawImage(templateImage, 0, 0, cssWidth, cssHeight);

    // Decorative image elements (logos, signatures) sit above the background.
    for (const el of images) {
      drawImageElementOnCanvas(ctx, el, ensureDecoded(el.src), el.id === activeImageId, effectiveScale);
    }

    // Render QR Zones
    drawQrZonesOnCanvas(
      ctx,
      qrZones,
      activeQrId,
      isPlacingQr,
      qrGhostPos,
      templateImage,
      effectiveScale
    );

    // Render active alignment guide lines behind elements
    if (activeGuides.length > 0) {
      drawGuideLines(ctx, activeGuides, effectiveScale, cssWidth, cssHeight);
    }

    // Render unselected text boxes
    boxes.forEach((box) => {
      if (box.id !== activeBoxId) {
        const previewVal =
          box.kind === 'static'
            ? box.staticText ?? ''
            : csvData.length > 0
              ? resolveFieldValue(box.field, csvData[0])
              : '';
        const previewText =
          box.kind === 'static'
            ? previewVal || undefined
            : previewVal || (previewEnabled ? (box.field || 'Sample Text') : undefined);
        drawBoxOnCanvas(ctx, box, false, effectiveScale, previewEnabled, fontPreview, previewText);
      }
    });

    // Render active text box
    const activeBox = boxes.find((b) => b.id === activeBoxId);
    if (activeBox) {
      const previewVal =
        activeBox.kind === 'static'
          ? activeBox.staticText ?? ''
          : csvData.length > 0
            ? resolveFieldValue(activeBox.field, csvData[0])
            : '';
      const previewText =
        activeBox.kind === 'static'
          ? previewVal || undefined
          : previewVal || (previewEnabled ? (activeBox.field || 'Sample Text') : undefined);
      drawBoxOnCanvas(ctx, activeBox, true, effectiveScale, previewEnabled, fontPreview, previewText);
    }

    // Render temporary drawing box
    if (tempBox && dragMode === 'draw') {
      drawBoxOnCanvas(ctx, tempBox, true, effectiveScale, previewEnabled, fontPreview);
    }

    ctx.restore();
  }, [
    templateImage,
    effectiveScale,
    activeGuides,
    boxes,
    activeBoxId,
    csvData,
    previewEnabled,
    fontPreview,
    tempBox,
    dragMode,
    images,
    activeImageId,
    ensureDecoded,
    qrZones,
    activeQrId,
    isPlacingQr,
    qrGhostPos,
  ]);

  useLayoutEffect(() => {
    render();
  }, [render, imageVersion]);

  const renderRef = useRef(render);
  useLayoutEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    const refreshFonts = () => {
      const context = canvasRef.current?.getContext('2d');
      if (context) clearTextMeasurements(context);
      renderRef.current();
    };
    document.fonts.addEventListener('loadingdone', refreshFonts);
    return () => document.fonts.removeEventListener('loadingdone', refreshFonts);
  }, []);

  const qrImageSubscriptions = useRef(new Map<string, () => void>());
  useEffect(() => {
    const subscriptions = qrImageSubscriptions.current;
    const sources = new Set(qrZones.flatMap((zone) => zone.style?.logo ? [zone.style.logo] : []));
    for (const [src, remove] of subscriptions) {
      if (sources.has(src)) continue;
      remove();
      subscriptions.delete(src);
    }
    for (const src of sources) {
      if (!subscriptions.has(src)) {
        subscriptions.set(src, subscribeToQrImage(src, () => renderRef.current()));
      }
    }
  }, [qrZones]);

  useEffect(() => {
    const subscriptions = qrImageSubscriptions.current;
    return () => {
      subscriptions.forEach((remove) => remove());
      subscriptions.clear();
    };
  }, []);

  // Refit after the sidebar or workspace changes size.
  useLayoutEffect(() => {
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

  // Background container mouse/pointer down (Pan mode & workspace background click)
  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      if (e.button === 1 || isSpacePressed) {
        setDragMode('pan');
        setPanDragStart({ x: e.clientX, y: e.clientY });
        setPanOrigin({ ...pan });
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        return;
      }

      if (e.target === containerRef.current) {
        setActiveBox(null);
        setActiveQrId(null);
        setActiveImage(null);
      }
    },
    [isSpacePressed, pan, setActiveBox, setActiveQrId, setActiveImage]
  );

  // Canvas element mouse/pointer down
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      if (!templateImage) return;

      if (e.button === 1 || isSpacePressed) {
        setDragMode('pan');
        setPanDragStart({ x: e.clientX, y: e.clientY });
        setPanOrigin({ ...pan });
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
        return;
      }

      if (e.button !== 0) return;

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

      if (imgX < 0 || imgX > templateImage.width || imgY < 0 || imgY > templateImage.height) {
        setActiveBox(null);
        setActiveQrId(null);
        setActiveImage(null);
        return;
      }

      // QR Placement Mode: Click to drop new QR code
      if (isPlacingQr) {
        const defaultSize = Math.max(1, Math.round(Math.min(templateImage.width, templateImage.height) * 0.15));
        const targetX = Math.max(0, Math.min(imgX - defaultSize / 2, templateImage.width - defaultSize));
        const targetY = Math.max(0, Math.min(imgY - defaultSize / 2, templateImage.height - defaultSize));
        pushState(boxes, qrZones);
        addQrZone(targetX, targetY, defaultSize);
        setIsPlacingQr(false);
        setQrGhostPos(null);
        return;
      }

      const activeBox = boxes.find((b) => b.id === activeBoxId);
      const handle = getHandleAtPoint(imgX, imgY, activeBox, effectiveScale);
      if (handle && activeBox) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setDragMode('resize');
        setActiveHandle(handle);
        setOriginalBox({ ...activeBox });
        setDragStart({ x: imgX, y: imgY });
        return;
      }

      const activeImg = images.find((el) => el.id === activeImageId);
      const imgHandle = getHandleAtPoint(imgX, imgY, activeImg, effectiveScale);
      if (imgHandle && activeImg) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setDragMode('img-resize');
        setActiveHandle(imgHandle);
        setOriginalImage({ ...activeImg });
        setDragStart({ x: imgX, y: imgY });
        return;
      }

      const clickedBox = getBoxAtPoint(imgX, imgY, boxes);
      if (clickedBox) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setActiveBox(clickedBox.id);
        setActiveQrId(null);
        setActiveImage(null);
        setDragMode('move');
        setDragStart({ x: imgX, y: imgY });
        setOriginalBox({ ...clickedBox });
        return;
      }

      const activeZone = qrZones.find((z) => z.id === activeQrId);
      const qrResizeHandle = getQrResizeHandleAtPoint(imgX, imgY, activeZone, effectiveScale);
      if (qrResizeHandle) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setDragMode('qr-resize');
        setDragStart({ x: imgX, y: imgY });
        setOriginalQrZone({ ...qrResizeHandle });
        return;
      }

      const clickedQr = getQrZoneAtPoint(imgX, imgY, qrZones);
      if (clickedQr) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setActiveQrId(clickedQr.id);
        setActiveBox(null);
        setActiveImage(null);
        setDragMode('qr-move');
        setDragStart({ x: imgX, y: imgY });
        setOriginalQrZone({ ...clickedQr });
        return;
      }

      // Images are background decorations: hit-tested last so boxes and QR
      // zones on top of them win.
      const clickedImage = getImageElementAtPoint(imgX, imgY, images);
      if (clickedImage) {
        savedPreDragStateRef.current = snapPreDrag(boxes, qrZones, images);
        setActiveImage(clickedImage.id);
        setActiveBox(null);
        setActiveQrId(null);
        setDragMode('img-move');
        setDragStart({ x: imgX, y: imgY });
        setOriginalImage({ ...clickedImage });
        return;
      }

      // Start drawing a new box
      setActiveQrId(null);
      setActiveBox(null);
      setActiveImage(null);
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
      boxes,
      activeBoxId,
      effectiveScale,
      pushState,
      qrZones,
      activeQrId,
      images,
      activeImageId,
      addQrZone,
      setIsPlacingQr,
      setActiveBox,
      setActiveQrId,
      setActiveImage,
    ]
  );

  // Window-level mouse move & mouse up for dragging / drawing (RAF throttled for 60-120 FPS performance)
  useEffect(() => {
    if (dragMode === 'none') return;

    let rafId: number | null = null;
    let latestEvent: MouseEvent | null = null;

    const processMove = () => {
      rafId = null;
      if (!latestEvent || !templateImage) return;
      const e = latestEvent;

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
      if (!dragMovedRef.current && clampedX === dragStart.x && clampedY === dragStart.y) return;
      dragMovedRef.current = true;

      if (dragMode === 'draw') {
        const x = Math.min(dragStart.x, clampedX);
        const y = Math.min(dragStart.y, clampedY);
        const w = Math.abs(clampedX - dragStart.x);
        const h = Math.abs(clampedY - dragStart.y);
        const bounds = { x, y, w, h };
        setTempBox(bounds);
        return bounds;
      } else if (dragMode === 'move' && originalBox) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        let targetX = originalBox.x + dx;
        let targetY = originalBox.y + dy;
        targetX = Math.max(0, Math.min(targetX, templateImage.width - originalBox.w));
        targetY = Math.max(0, Math.min(targetY, templateImage.height - originalBox.h));

        if (!e.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: originalBox.w, h: originalBox.h, id: originalBox.id },
            templateImage.width,
            templateImage.height,
            boxes,
            qrZones,
            false,
            8 / effectiveScale
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
            8 / effectiveScale
          );
          updateBox(
            originalBox.id,
            constrainResizedBox(snap, originalBox, activeHandle, templateImage.width, templateImage.height, MIN_DRAG_SIZE / effectiveScale)
          );
          setActiveGuides(snap.guides);
        } else {
          updateBox(
            originalBox.id,
            constrainResizedBox(rawBox, originalBox, activeHandle, templateImage.width, templateImage.height, MIN_DRAG_SIZE / effectiveScale)
          );
          setActiveGuides([]);
        }
      } else if (dragMode === 'img-move' && originalImage) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const targetX = Math.max(0, Math.min(originalImage.x + dx, templateImage.width - originalImage.w));
        const targetY = Math.max(0, Math.min(originalImage.y + dy, templateImage.height - originalImage.h));
        updateImage(originalImage.id, { x: targetX, y: targetY });
      } else if (dragMode === 'img-resize' && activeHandle && originalImage) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const raw = { ...originalImage };
        if (activeHandle.includes('w')) {
          raw.x = originalImage.x + dx;
          raw.w = originalImage.w - dx;
        }
        if (activeHandle.includes('e')) {
          raw.w = originalImage.w + dx;
        }
        if (activeHandle.includes('n')) {
          raw.y = originalImage.y + dy;
          raw.h = originalImage.h - dy;
        }
        if (activeHandle.includes('s')) {
          raw.h = originalImage.h + dy;
        }
        updateImage(
          originalImage.id,
          constrainResizedBox(raw, originalImage, activeHandle, templateImage.width, templateImage.height, MIN_DRAG_SIZE / effectiveScale)
        );
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
            8 / effectiveScale
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
        const rawSize = originalQrZone.size + (Math.abs(dx) > Math.abs(dy) ? dx : dy);
        const maxSize = Math.min(
          templateImage.width - originalQrZone.x,
          templateImage.height - originalQrZone.y
        );
        const newSize = Math.min(maxSize, Math.max(MIN_DRAG_SIZE / effectiveScale, rawSize));
        updateQrZone(originalQrZone.id, { size: newSize });
      }
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      latestEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(processMove);
      }
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      latestEvent = event;
      const drawnBox = processMove();
      latestEvent = null;
      const currentState = useAppStore.getState();

      if (drawnBox && drawnBox.w * effectiveScale >= MIN_DRAG_SIZE && drawnBox.h * effectiveScale >= MIN_DRAG_SIZE) {
        pushState(currentState.boxes, currentState.qrZones);
        addBox(drawnBox);
      } else if (dragMode === 'move' || dragMode === 'resize') {
        if (originalBox && savedPreDragStateRef.current) {
          const current = currentState.boxes.find((b) => b.id === originalBox.id);
          if (
            current &&
            (current.x !== originalBox.x ||
              current.y !== originalBox.y ||
              current.w !== originalBox.w ||
              current.h !== originalBox.h)
          ) {
            pushState(savedPreDragStateRef.current.boxes, savedPreDragStateRef.current.qrZones);
          }
        }
      } else if (dragMode === 'qr-move' || dragMode === 'qr-resize') {
        if (originalQrZone && savedPreDragStateRef.current) {
          const current = currentState.qrZones.find((z) => z.id === originalQrZone.id);
          if (
            current &&
            (current.x !== originalQrZone.x ||
              current.y !== originalQrZone.y ||
              current.size !== originalQrZone.size)
          ) {
            pushState(
              savedPreDragStateRef.current.boxes,
              savedPreDragStateRef.current.qrZones,
              savedPreDragStateRef.current.images
            );
          }
        }
      } else if (dragMode === 'img-move' || dragMode === 'img-resize') {
        if (originalImage && savedPreDragStateRef.current) {
          const current = currentState.images.find((el) => el.id === originalImage.id);
          if (
            current &&
            (current.x !== originalImage.x ||
              current.y !== originalImage.y ||
              current.w !== originalImage.w ||
              current.h !== originalImage.h)
          ) {
            pushState(
              savedPreDragStateRef.current.boxes,
              savedPreDragStateRef.current.qrZones,
              savedPreDragStateRef.current.images
            );
          }
        }
      }

      savedPreDragStateRef.current = null;
      dragMovedRef.current = false;
      setDragMode('none');
      setActiveHandle(null);
      setOriginalBox(null);
      setOriginalQrZone(null);
      setOriginalImage(null);
      setTempBox(null);
      setActiveGuides([]);
      document.body.style.cursor = '';
      if (canvasRef.current) {
        canvasRef.current.style.cursor = isSpacePressed ? 'grab' : 'crosshair';
      }
    };

    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    const moveEvent = hasPointer ? 'pointermove' : 'mousemove';
    const upEvent = hasPointer ? 'pointerup' : 'mouseup';

    window.addEventListener(moveEvent, handleWindowMouseMove as EventListener);
    window.addEventListener(upEvent, handleWindowMouseUp as EventListener);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener(moveEvent, handleWindowMouseMove as EventListener);
      window.removeEventListener(upEvent, handleWindowMouseUp as EventListener);
    };
  }, [
    dragMode,
    panDragStart,
    panOrigin,
    dragStart,
    originalBox,
    originalImage,
    activeHandle,
    originalQrZone,
    effectiveScale,
    boxes,
    qrZones,
    screenToImage,
    updateBox,
    updateQrZone,
    updateImage,
    templateImage,
    addBox,
    pushState,
    setPan,
    isSpacePressed,
  ]);

  // Hover cursor styling when not dragging. Coalesced to one pass per
  // animation frame: pointermove fires at trackpad rate (120-250 Hz) and every
  // QR-ghost update re-renders the full canvas.
  const applyHoverUpdate = useCallback(
    (clientX: number, clientY: number) => {
      if (!templateImage) return;

      if (isSpacePressed) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        return;
      }

      const { x: imgX, y: imgY } = screenToImage(clientX, clientY);

      if (isPlacingQr) {
        setQrGhostPos({ x: imgX, y: imgY });
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      } else if (qrGhostPos) {
        setQrGhostPos(null);
      }

      const activeZone = qrZones.find((z) => z.id === activeQrId);
      if (getQrResizeHandleAtPoint(imgX, imgY, activeZone, effectiveScale)) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'nwse-resize';
        return;
      }

      const qrAtPoint = getQrZoneAtPoint(imgX, imgY, qrZones);
      if (qrAtPoint) {
        if (canvasRef.current) {
          canvasRef.current.style.cursor = qrAtPoint.id === activeQrId ? 'move' : 'pointer';
        }
        return;
      }

      const activeBox = boxes.find((b) => b.id === activeBoxId);
      const handle = getHandleAtPoint(imgX, imgY, activeBox, effectiveScale);
      if (handle && canvasRef.current) {
        const cursorMap: Record<HandleKey, string> = {
          nw: 'nwse-resize',
          n: 'ns-resize',
          ne: 'nesw-resize',
          e: 'ew-resize',
          se: 'nwse-resize',
          s: 'ns-resize',
          sw: 'nesw-resize',
          w: 'ew-resize',
        };
        canvasRef.current.style.cursor = cursorMap[handle];
        return;
      }

      const box = getBoxAtPoint(imgX, imgY, boxes);
      if (box && canvasRef.current) {
        canvasRef.current.style.cursor = 'move';
        return;
      }

      const hoveredImage = getImageElementAtPoint(imgX, imgY, images);
      if (hoveredImage && canvasRef.current) {
        canvasRef.current.style.cursor = 'move';
        return;
      }

      if (canvasRef.current) {
        canvasRef.current.style.cursor = 'crosshair';
      }
    },
    [
      templateImage,
      isSpacePressed,
      screenToImage,
      isPlacingQr,
      qrGhostPos,
      qrZones,
      activeQrId,
      effectiveScale,
      boxes,
      activeBoxId,
      images,
    ]
  );

  const hoverRafRef = useRef<number | null>(null);
  const hoverEventRef = useRef<{ clientX: number; clientY: number } | null>(null);
  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
    };
  }, []);

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      if (dragMode !== 'none' || !templateImage) return;
      hoverEventRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const evt = hoverEventRef.current;
        hoverEventRef.current = null;
        if (evt) applyHoverUpdate(evt.clientX, evt.clientY);
      });
    },
    [dragMode, templateImage, applyHoverUpdate]
  );

  const activeBox = boxes.find((b) => b.id === activeBoxId);
  const activeQr = qrZones.find((z) => z.id === activeQrId);

  if (!templateImage) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none"
        style={{
          backgroundColor: '#f1f4f9',
          backgroundImage: `
            linear-gradient(to right, rgba(100, 116, 139, 0.08) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(100, 116, 139, 0.08) 1px, transparent 1px)
          `,
          backgroundSize: '16px 16px',
          backgroundAttachment: 'fixed',
        }}
      >
        <ImageIcon className="w-10 h-10 text-slate-400 stroke-[1.5] mb-3" />
        <h3 className="text-base sm:text-lg font-semibold text-slate-700 mb-1">
          Upload a template to get started
        </h3>
        <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
          Select a certificate template image on the left sidebar to begin placing text fields and verification QR codes.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleContainerMouseDown}
      className={`flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative select-none ${
        isSpacePressed ? (dragMode === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      style={{
        touchAction: 'none',
        backgroundColor: '#f1f4f9',
        backgroundImage: `
          linear-gradient(to right, rgba(100, 116, 139, 0.08) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(100, 116, 139, 0.08) 1px, transparent 1px)
        `,
        backgroundSize: '16px 16px',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Pannable Canvas Container */}
      <div
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="bg-white block"
          style={{
            touchAction: 'none',
            outline: `3px solid ${adaptiveBorder.borderColor}`,
            outlineOffset: '0px',
            boxShadow: `
              0 0 0 4px ${adaptiveBorder.outerRing},
              ${adaptiveBorder.shadow}
            `,
          }}
          onPointerDown={handleCanvasMouseDown}
          onPointerMove={handleCanvasMouseMove}
          tabIndex={0}
        />
      </div>

      {/* Floating Modern Studio Toolbar */}
      <CanvasToolbar
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        onResetFit={handleResetFit}
        isZoomMenuOpen={isZoomMenuOpen}
        setIsZoomMenuOpen={setIsZoomMenuOpen}
        zoomMenuRef={zoomMenuRef}
        onResetLayout={() => {
          setBoxes([]);
          setQrZones([]);
          setActiveBox(null);
          setActiveQrId(null);
          handleResetFit();
          clearHistory();
        }}
      />
    </div>
  );
}
