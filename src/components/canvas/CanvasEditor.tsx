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
import type { TextBox, QrZone, ImageElement, CsvRow } from '../../types';
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

interface DragSession {
  mode: DragMode;
  pointerId: number | null;
  dragStart: { x: number; y: number };
  panDragStart: { x: number; y: number };
  panOrigin: { x: number; y: number };
  activeHandle: HandleKey | null;
  originalBox: TextBox | null;
  originalQrZone: { id: string; x: number; y: number; size: number } | null;
  originalImage: ImageElement | null;
  preDragSnapshot: { boxes: TextBox[]; qrZones: QrZone[]; images: ImageElement[] } | null;
  moved: boolean;
}

function resolveBoxPreviewText(box: TextBox, csvData: CsvRow[], previewEnabled: boolean): string | undefined {
  if (box.kind === 'static') return box.staticText || undefined;
  if (csvData.length > 0) {
    const resolved = resolveFieldValue(box.field, csvData[0]);
    if (resolved) return resolved;
  }
  return previewEnabled ? (box.field || 'Sample Text') : undefined;
}

function computeResizedRaw(original: Bounds, handle: HandleKey, dx: number, dy: number): Bounds {
  const raw = { x: original.x, y: original.y, w: original.w, h: original.h };
  if (handle.includes('w')) {
    raw.x = original.x + dx;
    raw.w = original.w - dx;
  }
  if (handle.includes('e')) {
    raw.w = original.w + dx;
  }
  if (handle.includes('n')) {
    raw.y = original.y + dy;
    raw.h = original.h - dy;
  }
  if (handle.includes('s')) {
    raw.h = original.h + dy;
  }
  return raw;
}

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
  // Pre-scaled template background buffer so drags/hovers blit cleanly at low cost.
  const backgroundCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    image: HTMLImageElement;
    width: number;
    height: number;
  } | null>(null);

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
    images,
    activeImageId,
    updateImage,
    deleteImage,
    setActiveImage,
    setImages,
  } = useAppStore();

  const { past, future, pushState, undo, redo, clearHistory } = useHistoryStore();

  const adaptiveBorder = useAdaptiveBorder(templateImage);

  // Drag mode triggers one-time mount of window listeners; mutable session data
  // stays in a ref so 60-120fps moves never re-subscribe window listeners per frame.
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const dragSessionRef = useRef<DragSession>({
    mode: 'none',
    pointerId: null,
    dragStart: { x: 0, y: 0 },
    panDragStart: { x: 0, y: 0 },
    panOrigin: { x: 0, y: 0 },
    activeHandle: null,
    originalBox: null,
    originalQrZone: null,
    originalImage: null,
    preDragSnapshot: null,
    moved: false,
  });
  const [tempBox, setTempBox] = useState<Bounds | null>(null);
  const [qrGhostPos, setQrGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);

  // Decoded image elements for on-canvas preview; keyed by src.
  const decodedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageVersion, bumpImageVersion] = useState(0);
  const ensureDecoded = useCallback((src: string): HTMLImageElement | null => {
    const cached = decodedImagesRef.current.get(src);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    const img = new Image();
    img.onload = () => bumpImageVersion((version) => version + 1);
    img.onerror = () => decodedImagesRef.current.delete(src);
    decodedImagesRef.current.set(src, img);
    img.src = src;
    return null;
  }, []);

  useEffect(() => {
    for (const src of decodedImagesRef.current.keys()) {
      if (!images.some((image) => image.src === src)) decodedImagesRef.current.delete(src);
    }
  }, [images]);

  const applySnapshot = useCallback(
    (snapshot: { boxes: TextBox[]; qrZones?: QrZone[]; images?: ImageElement[]; qrZone?: QrZone | null }) => {
      const nextQrZones = snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []);
      const nextImages = snapshot.images ?? useAppStore.getState().images;
      setBoxes(snapshot.boxes);
      setQrZones(nextQrZones);
      setImages(nextImages);
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
      pushState(boxes, qrZones, images);
      deleteBox(activeBoxId);
    } else if (activeQrId) {
      pushState(boxes, qrZones, images);
      deleteQrZone(activeQrId);
    } else if (activeImageId) {
      pushState(boxes, qrZones, images);
      deleteImage(activeImageId);
    }
  }, [activeBoxId, activeQrId, activeImageId, boxes, qrZones, images, pushState, deleteBox, deleteQrZone, deleteImage]);

  // A burst of nudges (held arrow key) is one undo step, not one per pixel.
  const lastNudgeAtRef = useRef(0);
  const pushNudgeState = useCallback(() => {
    const now = Date.now();
    if (now - lastNudgeAtRef.current > 600) pushState(boxes, qrZones, images);
    lastNudgeAtRef.current = now;
  }, [pushState, boxes, qrZones, images]);

  const handleArrowNudge = useCallback(
    (dx: number, dy: number) => {
      const clampX = (x: number, w: number) => Math.max(0, Math.min(x, templateImage ? templateImage.width - w : x));
      const clampY = (y: number, h: number) => Math.max(0, Math.min(y, templateImage ? templateImage.height - h : y));

      if (activeBoxId) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          pushNudgeState();
          updateBox(activeBoxId, { x: clampX(activeBox.x + dx, activeBox.w), y: clampY(activeBox.y + dy, activeBox.h) });
        }
      } else if (activeQrId) {
        const activeQr = qrZones.find((z) => z.id === activeQrId);
        if (activeQr) {
          pushNudgeState();
          updateQrZone(activeQrId, { x: clampX(activeQr.x + dx, activeQr.size), y: clampY(activeQr.y + dy, activeQr.size) });
        }
      } else if (activeImageId) {
        const activeImg = images.find((el) => el.id === activeImageId);
        if (activeImg) {
          pushNudgeState();
          updateImage(activeImageId, { x: clampX(activeImg.x + dx, activeImg.w), y: clampY(activeImg.y + dy, activeImg.h) });
        }
      }
    },
    [activeBoxId, activeQrId, activeImageId, boxes, qrZones, images, pushNudgeState, updateBox, updateQrZone, updateImage, templateImage]
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

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

    // Cache scaled template artwork at backing resolution so interactive drags/hovers
    // avoid re-sampling full 4K bitmaps every frame on low-end GPUs.
    let bgCache = backgroundCacheRef.current;
    if (!bgCache || bgCache.image !== templateImage || bgCache.width !== width || bgCache.height !== height) {
      const cacheCanvas = bgCache?.canvas ?? document.createElement('canvas');
      cacheCanvas.width = width;
      cacheCanvas.height = height;
      const cacheCtx = cacheCanvas.getContext('2d');
      if (cacheCtx) {
        cacheCtx.clearRect(0, 0, width, height);
        cacheCtx.drawImage(templateImage, 0, 0, width, height);
        bgCache = { canvas: cacheCanvas, image: templateImage, width, height };
        backgroundCacheRef.current = bgCache;
      }
    }

    ctx.save();
    ctx.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (bgCache) ctx.drawImage(bgCache.canvas, 0, 0, cssWidth, cssHeight);
    else ctx.drawImage(templateImage, 0, 0, cssWidth, cssHeight);

    for (const el of images) {
      drawImageElementOnCanvas(ctx, el, ensureDecoded(el.src), el.id === activeImageId, effectiveScale);
    }

    drawQrZonesOnCanvas(ctx, qrZones, activeQrId, isPlacingQr, qrGhostPos, templateImage, effectiveScale);

    if (activeGuides.length > 0) {
      drawGuideLines(ctx, activeGuides, effectiveScale, cssWidth, cssHeight);
    }

    for (const box of boxes) {
      if (box.id === activeBoxId) continue;
      drawBoxOnCanvas(ctx, box, false, effectiveScale, previewEnabled, fontPreview, resolveBoxPreviewText(box, csvData, previewEnabled));
    }

    const activeBox = boxes.find((b) => b.id === activeBoxId);
    if (activeBox) {
      drawBoxOnCanvas(ctx, activeBox, true, effectiveScale, previewEnabled, fontPreview, resolveBoxPreviewText(activeBox, csvData, previewEnabled));
    }

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
  const effectiveScaleRef = useRef(effectiveScale);
  const templateImageRef = useRef(templateImage);
  const screenToImageRef = useRef(screenToImage);
  const isSpacePressedRef = useRef(isSpacePressed);
  useLayoutEffect(() => {
    renderRef.current = render;
    effectiveScaleRef.current = effectiveScale;
    templateImageRef.current = templateImage;
    screenToImageRef.current = screenToImage;
    isSpacePressedRef.current = isSpacePressed;
  }, [render, effectiveScale, templateImage, screenToImage, isSpacePressed]);

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
    const sources = new Set(qrZones.flatMap((zone) => (zone.style?.logo ? [zone.style.logo] : [])));
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

  const startDragSession = useCallback((mode: DragMode, pointerId: number | null, patch: Partial<DragSession>) => {
    const { boxes: b, qrZones: z, images: im } = useAppStore.getState();
    dragSessionRef.current = {
      mode,
      pointerId,
      dragStart: patch.dragStart ?? { x: 0, y: 0 },
      panDragStart: patch.panDragStart ?? { x: 0, y: 0 },
      panOrigin: patch.panOrigin ?? { x: 0, y: 0 },
      activeHandle: patch.activeHandle ?? null,
      originalBox: patch.originalBox ?? null,
      originalQrZone: patch.originalQrZone ?? null,
      originalImage: patch.originalImage ?? null,
      preDragSnapshot: { boxes: b, qrZones: z, images: im },
      moved: false,
    };
    setDragMode(mode);
  }, []);

  // Background container pointer down (Pan mode & workspace background click)
  const handleContainerMouseDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || isSpacePressed) {
        startDragSession('pan', e.pointerId, {
          panDragStart: { x: e.clientX, y: e.clientY },
          panOrigin: { ...pan },
        });
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
    [isSpacePressed, pan, startDragSession, setActiveBox, setActiveQrId, setActiveImage]
  );

  // Canvas element pointer down
  const handleCanvasMouseDown = useCallback(
    (e: React.PointerEvent) => {
      if (!templateImage) return;

      // Cancel in-progress canvas draw if a multi-touch gesture begins (e.g. pinch-to-zoom).
      if (!e.isPrimary) {
        if (dragSessionRef.current.mode === 'draw') {
          dragSessionRef.current.mode = 'none';
          dragSessionRef.current.pointerId = null;
          setDragMode('none');
          setTempBox(null);
        }
        return;
      }

      if (e.button === 1 || isSpacePressed) {
        startDragSession('pan', e.pointerId, {
          panDragStart: { x: e.clientX, y: e.clientY },
          panOrigin: { ...pan },
        });
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

      if (isPlacingQr) {
        const defaultSize = Math.max(1, Math.round(Math.min(templateImage.width, templateImage.height) * 0.15));
        const targetX = Math.max(0, Math.min(imgX - defaultSize / 2, templateImage.width - defaultSize));
        const targetY = Math.max(0, Math.min(imgY - defaultSize / 2, templateImage.height - defaultSize));
        pushState(boxes, qrZones, images);
        addQrZone(targetX, targetY, defaultSize);
        setIsPlacingQr(false);
        setQrGhostPos(null);
        return;
      }

      const activeBox = boxes.find((b) => b.id === activeBoxId);
      const handle = getHandleAtPoint(imgX, imgY, activeBox, effectiveScale);
      if (handle && activeBox) {
        startDragSession('resize', e.pointerId, {
          activeHandle: handle,
          originalBox: { ...activeBox },
          dragStart: { x: imgX, y: imgY },
        });
        return;
      }

      const activeImg = images.find((el) => el.id === activeImageId);
      const imgHandle = getHandleAtPoint(imgX, imgY, activeImg, effectiveScale);
      if (imgHandle && activeImg) {
        startDragSession('img-resize', e.pointerId, {
          activeHandle: imgHandle,
          originalImage: { ...activeImg },
          dragStart: { x: imgX, y: imgY },
        });
        return;
      }

      const clickedBox = getBoxAtPoint(imgX, imgY, boxes);
      if (clickedBox) {
        setActiveBox(clickedBox.id);
        startDragSession('move', e.pointerId, {
          dragStart: { x: imgX, y: imgY },
          originalBox: { ...clickedBox },
        });
        return;
      }

      const activeZone = qrZones.find((z) => z.id === activeQrId);
      const qrResizeHandle = getQrResizeHandleAtPoint(imgX, imgY, activeZone, effectiveScale);
      if (qrResizeHandle) {
        startDragSession('qr-resize', e.pointerId, {
          dragStart: { x: imgX, y: imgY },
          originalQrZone: { ...qrResizeHandle },
        });
        return;
      }

      const clickedQr = getQrZoneAtPoint(imgX, imgY, qrZones);
      if (clickedQr) {
        setActiveQrId(clickedQr.id);
        startDragSession('qr-move', e.pointerId, {
          dragStart: { x: imgX, y: imgY },
          originalQrZone: { ...clickedQr },
        });
        return;
      }

      // Decorative images sit behind boxes and QR zones.
      const clickedImage = getImageElementAtPoint(imgX, imgY, images);
      if (clickedImage) {
        setActiveImage(clickedImage.id);
        startDragSession('img-move', e.pointerId, {
          dragStart: { x: imgX, y: imgY },
          originalImage: { ...clickedImage },
        });
        return;
      }

      setActiveQrId(null);
      setActiveBox(null);
      setActiveImage(null);
      startDragSession('draw', e.pointerId, { dragStart: { x: imgX, y: imgY } });
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
      startDragSession,
    ]
  );

  // Window-level drag tracking mounted ONCE per drag gesture (no per-frame listener churn).
  useEffect(() => {
    if (dragMode === 'none') return;

    let rafId: number | null = null;
    let latestEvent: PointerEvent | null = null;

    const processMove = (): Bounds | undefined => {
      rafId = null;
      const session = dragSessionRef.current;
      const tpl = templateImageRef.current;
      const scale = effectiveScaleRef.current;
      const evt = latestEvent;
      if (!evt || !tpl || session.mode === 'none') return undefined;

      if (session.mode === 'pan') {
        setPan({
          x: session.panOrigin.x + (evt.clientX - session.panDragStart.x),
          y: session.panOrigin.y + (evt.clientY - session.panDragStart.y),
        });
        return undefined;
      }

      const { x: imgX, y: imgY } = screenToImageRef.current(evt.clientX, evt.clientY);
      const clampedX = Math.max(0, Math.min(imgX, tpl.width));
      const clampedY = Math.max(0, Math.min(imgY, tpl.height));
      if (!session.moved && clampedX === session.dragStart.x && clampedY === session.dragStart.y) return undefined;
      session.moved = true;

      const store = useAppStore.getState();
      const threshold = 8 / scale;
      const minSize = MIN_DRAG_SIZE / scale;

      if (session.mode === 'draw') {
        const bounds: Bounds = {
          x: Math.min(session.dragStart.x, clampedX),
          y: Math.min(session.dragStart.y, clampedY),
          w: Math.abs(clampedX - session.dragStart.x),
          h: Math.abs(clampedY - session.dragStart.y),
        };
        setTempBox(bounds);
        return bounds;
      }

      if (session.mode === 'move' && session.originalBox) {
        const orig = session.originalBox;
        const targetX = Math.max(0, Math.min(orig.x + (clampedX - session.dragStart.x), tpl.width - orig.w));
        const targetY = Math.max(0, Math.min(orig.y + (clampedY - session.dragStart.y), tpl.height - orig.h));

        if (!evt.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: orig.w, h: orig.h, id: orig.id },
            tpl.width,
            tpl.height,
            store.boxes,
            store.qrZones,
            false,
            threshold,
            store.images
          );
          store.updateBox(orig.id, { x: snap.x, y: snap.y });
          setActiveGuides(snap.guides);
        } else {
          store.updateBox(orig.id, { x: targetX, y: targetY });
          setActiveGuides([]);
        }
      } else if (session.mode === 'resize' && session.activeHandle && session.originalBox) {
        const orig = session.originalBox;
        const raw = computeResizedRaw(orig, session.activeHandle, clampedX - session.dragStart.x, clampedY - session.dragStart.y);
        if (!evt.altKey) {
          const snap = calculateResizeSnapping(
            { ...raw, id: orig.id },
            session.activeHandle,
            tpl.width,
            tpl.height,
            store.boxes,
            store.qrZones,
            false,
            threshold,
            minSize,
            store.images
          );
          store.updateBox(orig.id, constrainResizedBox(snap, orig, session.activeHandle, tpl.width, tpl.height, minSize));
          setActiveGuides(snap.guides);
        } else {
          store.updateBox(orig.id, constrainResizedBox(raw, orig, session.activeHandle, tpl.width, tpl.height, minSize));
          setActiveGuides([]);
        }
      } else if (session.mode === 'img-move' && session.originalImage) {
        const orig = session.originalImage;
        const targetX = Math.max(0, Math.min(orig.x + (clampedX - session.dragStart.x), tpl.width - orig.w));
        const targetY = Math.max(0, Math.min(orig.y + (clampedY - session.dragStart.y), tpl.height - orig.h));
        if (!evt.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: orig.w, h: orig.h, id: orig.id },
            tpl.width,
            tpl.height,
            store.boxes,
            store.qrZones,
            false,
            threshold,
            store.images
          );
          store.updateImage(orig.id, { x: snap.x, y: snap.y });
          setActiveGuides(snap.guides);
        } else {
          store.updateImage(orig.id, { x: targetX, y: targetY });
          setActiveGuides([]);
        }
      } else if (session.mode === 'img-resize' && session.activeHandle && session.originalImage) {
        const orig = session.originalImage;
        const raw = computeResizedRaw(orig, session.activeHandle, clampedX - session.dragStart.x, clampedY - session.dragStart.y);
        store.updateImage(orig.id, constrainResizedBox(raw, orig, session.activeHandle, tpl.width, tpl.height, minSize));
      } else if (session.mode === 'qr-move' && session.originalQrZone) {
        const orig = session.originalQrZone;
        const targetX = Math.max(0, Math.min(orig.x + (clampedX - session.dragStart.x), tpl.width - orig.size));
        const targetY = Math.max(0, Math.min(orig.y + (clampedY - session.dragStart.y), tpl.height - orig.size));

        if (!evt.altKey) {
          const snap = calculateMoveSnapping(
            { x: targetX, y: targetY, w: orig.size, h: orig.size, id: orig.id },
            tpl.width,
            tpl.height,
            store.boxes,
            store.qrZones,
            true,
            threshold,
            store.images
          );
          store.updateQrZone(orig.id, { x: snap.x, y: snap.y });
          setActiveGuides(snap.guides);
        } else {
          store.updateQrZone(orig.id, { x: targetX, y: targetY });
          setActiveGuides([]);
        }
      } else if (session.mode === 'qr-resize' && session.originalQrZone) {
        const orig = session.originalQrZone;
        const dx = clampedX - session.dragStart.x;
        const dy = clampedY - session.dragStart.y;
        const rawSize = orig.size + (Math.abs(dx) > Math.abs(dy) ? dx : dy);
        const maxSize = Math.min(tpl.width - orig.x, tpl.height - orig.y);
        store.updateQrZone(orig.id, { size: Math.min(maxSize, Math.max(minSize, rawSize)) });
      }
      return undefined;
    };

    const finishDrag = (commitEvent: PointerEvent | null) => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const session = dragSessionRef.current;
      const scale = effectiveScaleRef.current;
      let drawnBox: Bounds | undefined;
      if (commitEvent) {
        latestEvent = commitEvent;
        drawnBox = processMove();
      }
      latestEvent = null;

      const store = useAppStore.getState();
      const pre = session.preDragSnapshot;

      if (commitEvent && drawnBox && drawnBox.w * scale >= MIN_DRAG_SIZE && drawnBox.h * scale >= MIN_DRAG_SIZE) {
        pushState(store.boxes, store.qrZones, store.images);
        store.addBox(drawnBox);
      } else if ((session.mode === 'move' || session.mode === 'resize') && session.originalBox && pre) {
        const orig = session.originalBox;
        const cur = store.boxes.find((b) => b.id === orig.id);
        if (cur && (cur.x !== orig.x || cur.y !== orig.y || cur.w !== orig.w || cur.h !== orig.h)) {
          pushState(pre.boxes, pre.qrZones, pre.images);
        }
      } else if ((session.mode === 'qr-move' || session.mode === 'qr-resize') && session.originalQrZone && pre) {
        const orig = session.originalQrZone;
        const cur = store.qrZones.find((z) => z.id === orig.id);
        if (cur && (cur.x !== orig.x || cur.y !== orig.y || cur.size !== orig.size)) {
          pushState(pre.boxes, pre.qrZones, pre.images);
        }
      } else if ((session.mode === 'img-move' || session.mode === 'img-resize') && session.originalImage && pre) {
        const orig = session.originalImage;
        const cur = store.images.find((el) => el.id === orig.id);
        if (cur && (cur.x !== orig.x || cur.y !== orig.y || cur.w !== orig.w || cur.h !== orig.h)) {
          pushState(pre.boxes, pre.qrZones, pre.images);
        }
      }

      session.mode = 'none';
      session.pointerId = null;
      session.preDragSnapshot = null;
      session.moved = false;
      setDragMode('none');
      setTempBox(null);
      setActiveGuides([]);
      document.body.style.cursor = '';
      if (canvasRef.current) {
        canvasRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : 'crosshair';
      }
    };

    const handleMove = (e: PointerEvent) => {
      if (dragSessionRef.current.pointerId !== null && e.pointerId !== dragSessionRef.current.pointerId) return;
      latestEvent = e;
      if (rafId === null) rafId = requestAnimationFrame(() => { processMove(); });
    };

    const handleUp = (e: PointerEvent) => {
      if (dragSessionRef.current.pointerId !== null && e.pointerId !== dragSessionRef.current.pointerId) return;
      finishDrag(e);
    };

    const handleCancel = () => finishDrag(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleCancel);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleCancel);
    };
  }, [dragMode, pushState, setPan]);

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
          setImages([]);
          setActiveBox(null);
          setActiveQrId(null);
          setActiveImage(null);
          backgroundCacheRef.current = null;
          handleResetFit();
          clearHistory();
        }}
      />
    </div>
  );
}
