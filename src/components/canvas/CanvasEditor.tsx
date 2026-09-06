'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import {
  calculateMoveSnapping,
  calculateResizeSnapping,
  drawGuideLines,
  type GuideLine,
  type HandleKey,
} from '../../lib/canvas-snapping';
import type { TextBox } from '../../types';
import { useAdaptiveBorder } from './useAdaptiveBorder';
import { useCanvasZoomPan } from './useCanvasZoomPan';
import {
  drawBoxOnCanvas,
  drawQrZonesOnCanvas,
  getHandleAtPoint,
  getBoxAtPoint,
  getQrZoneAtPoint,
  getQrResizeHandleAtPoint,
  QR_MIN_SIZE,
} from './canvas-renderer';
import { CanvasToolbar } from './CanvasToolbar';

type DragMode = 'none' | 'draw' | 'move' | 'resize' | 'qr-move' | 'qr-resize' | 'pan';

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

  const { past, future, pushState, undo, redo, clearHistory } = useHistoryStore();

  // Smart high-contrast border detection based on template edge luminance
  const adaptiveBorder = useAdaptiveBorder(templateImage);

  // Drag interaction state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panDragStart, setPanDragStart] = useState({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = useState({ x: 0, y: 0 });
  const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
  const [originalBox, setOriginalBox] = useState<TextBox | null>(null);
  const [tempBox, setTempBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [originalQrZone, setOriginalQrZone] = useState<{ id: string; x: number; y: number; size: number } | null>(null);
  const [qrGhostPos, setQrGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);

  // Undo / Redo / Delete callbacks
  const handleUndo = useCallback(() => {
    const snapshot = undo(boxes, qrZones);
    if (snapshot) {
      setBoxes(snapshot.boxes);
      setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
    }
  }, [undo, boxes, qrZones, setBoxes, setQrZones]);

  const handleRedo = useCallback(() => {
    const snapshot = redo(boxes, qrZones);
    if (snapshot) {
      setBoxes(snapshot.boxes);
      setQrZones(snapshot.qrZones || (snapshot.qrZone ? [snapshot.qrZone] : []));
    }
  }, [redo, boxes, qrZones, setBoxes, setQrZones]);

  const handleDeleteActive = useCallback(() => {
    if (activeBoxId) {
      pushState(boxes, qrZones);
      deleteBox(activeBoxId);
    } else if (activeQrId) {
      pushState(boxes, qrZones);
      deleteQrZone(activeQrId);
    }
  }, [activeBoxId, activeQrId, boxes, qrZones, pushState, deleteBox, deleteQrZone]);

  const handleArrowNudge = useCallback(
    (dx: number, dy: number) => {
      if (activeBoxId) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          pushState(boxes, qrZones);
          updateBox(activeBoxId, {
            x: Math.max(0, Math.min(activeBox.x + dx, templateImage ? templateImage.width - activeBox.w : activeBox.x)),
            y: Math.max(0, Math.min(activeBox.y + dy, templateImage ? templateImage.height - activeBox.h : activeBox.y)),
          });
        }
      } else if (activeQrId) {
        const activeQr = qrZones.find((z) => z.id === activeQrId);
        if (activeQr) {
          pushState(boxes, qrZones);
          updateQrZone(activeQrId, {
            x: Math.max(0, Math.min(activeQr.x + dx, templateImage ? templateImage.width - activeQr.size : activeQr.x)),
            y: Math.max(0, Math.min(activeQr.y + dy, templateImage ? templateImage.height - activeQr.size : activeQr.y)),
          });
        }
      }
    },
    [activeBoxId, activeQrId, boxes, qrZones, pushState, updateBox, updateQrZone, templateImage]
  );

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
    isDrawingEnabled: csvData.length > 0,
    onEscape: () => {
      setActiveBox(null);
      setActiveQrId(null);
      setIsPlacingQr(false);
      setIsZoomMenuOpen(false);
    },
  });

  // Placeholder QR shown inside zone while designing
  const placeholderImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL('CREDIFY-VERIFY-PLACEHOLDER', {
      margin: 1,
      width: 512,
      color: {
        dark: '#000000',
        light: '#00000000',
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

  // Main Canvas Rendering Loop
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

    // Render active alignment guide lines behind elements
    if (activeGuides.length > 0) {
      drawGuideLines(ctx, activeGuides, effectiveScale, cssWidth, cssHeight);
    }

    // Render unselected text boxes
    boxes.forEach((box) => {
      if (box.id !== activeBoxId) {
        const previewText = csvData.length > 0 && box.field ? csvData[0][box.field] : undefined;
        drawBoxOnCanvas(ctx, box, false, effectiveScale, previewEnabled, fontPreview, previewText);
      }
    });

    // Render active text box
    const activeBox = boxes.find((b) => b.id === activeBoxId);
    if (activeBox) {
      const previewText = csvData.length > 0 && activeBox.field ? csvData[0][activeBox.field] : undefined;
      drawBoxOnCanvas(ctx, activeBox, true, effectiveScale, previewEnabled, fontPreview, previewText);
    }

    // Render temporary drawing box
    if (tempBox && dragMode === 'draw') {
      drawBoxOnCanvas(ctx, tempBox, true, effectiveScale, previewEnabled, fontPreview);
    }

    // Render QR Zones
    drawQrZonesOnCanvas(
      ctx,
      qrZones,
      activeQrId,
      placeholderImgRef.current,
      isPlacingQr,
      qrGhostPos,
      templateImage,
      effectiveScale
    );

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
    qrZones,
    activeQrId,
    isPlacingQr,
    qrGhostPos,
  ]);

  useEffect(() => {
    render();
  }, [render]);

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

  // Background container mouse down (Pan mode & workspace background click)
  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
      }
    },
    [isSpacePressed, pan, setActiveBox, setActiveQrId]
  );

  // Canvas element mouse down
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
        return;
      }

      // Do not allow drawing text boxes or placing QR codes until CSV is uploaded
      if (csvData.length === 0) {
        return;
      }

      // QR Placement Mode: Click to drop new QR code
      if (isPlacingQr) {
        const defaultSize = Math.round(Math.min(templateImage.width, templateImage.height) * 0.15) || 180;
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
        pushState(boxes, qrZones);
        setDragMode('resize');
        setActiveHandle(handle);
        setOriginalBox({ ...activeBox });
        setDragStart({ x: imgX, y: imgY });
        return;
      }

      const clickedBox = getBoxAtPoint(imgX, imgY, boxes);
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

      const activeZone = qrZones.find((z) => z.id === activeQrId);
      const qrResizeHandle = getQrResizeHandleAtPoint(imgX, imgY, activeZone, effectiveScale);
      if (qrResizeHandle) {
        pushState(boxes, qrZones);
        setDragMode('qr-resize');
        setDragStart({ x: imgX, y: imgY });
        setOriginalQrZone({ ...qrResizeHandle });
        return;
      }

      const clickedQr = getQrZoneAtPoint(imgX, imgY, qrZones);
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

      // Start drawing a new box
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
      boxes,
      activeBoxId,
      effectiveScale,
      pushState,
      qrZones,
      activeQrId,
      addQrZone,
      setIsPlacingQr,
      setActiveBox,
      setActiveQrId,
    ]
  );

  // Window-level mouse move & mouse up for dragging / drawing
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
        canvasRef.current.style.cursor = isSpacePressed
          ? 'grab'
          : csvData.length === 0
          ? 'default'
          : isPlacingQr
          ? 'crosshair'
          : 'crosshair';
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
    setPan,
    isSpacePressed,
  ]);

  // Hover cursor styling when not dragging
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragMode !== 'none' || !templateImage) return;

      if (isSpacePressed) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        return;
      }

      // If CSV has not been uploaded, keep cursor default and deactivate drawing
      if (csvData.length === 0) {
        if (canvasRef.current) canvasRef.current.style.cursor = 'default';
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

      if (canvasRef.current) {
        canvasRef.current.style.cursor = 'crosshair';
      }
    },
    [
      dragMode,
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
    ]
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
        <div className="w-14 h-14 rounded-2xl bg-slate-200/80 border border-slate-300/80 flex items-center justify-center text-slate-500 mb-3 shadow-2xs">
          <ImageIcon className="w-7 h-7 text-slate-500 stroke-[1.75]" />
        </div>
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
      onMouseDown={handleContainerMouseDown}
      className={`flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative select-none ${
        isSpacePressed ? (dragMode === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
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
