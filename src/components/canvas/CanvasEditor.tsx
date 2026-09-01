'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { RotateCcw, Undo2, Redo2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { isFontLoaded, loadGoogleFont, getFontFamilyCSS } from '../../lib/font-loader';
import type { TextBox } from '../../types';

const HANDLE_SIZE = 8;
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 6;

type DragMode = 'none' | 'draw' | 'move' | 'resize';
type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function CanvasEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    templateImage,
    boxes,
    activeBoxId,
    displayScale,
    previewEnabled,
    csvData,
    csvFile,
    fontPreview,
    addBox,
    updateBox,
    deleteBox,
    setActiveBox,
    setDisplayScale,
    setBoxes,
    reset,
  } = useAppStore();

  const { past, future, pushState, undo, redo } = useHistoryStore();

  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
  const [originalBox, setOriginalBox] = useState<TextBox | null>(null);
  const [tempBox, setTempBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (screenX - rect.left) / displayScale,
        y: (screenY - rect.top) / displayScale,
      };
    },
    [displayScale]
  );

  const fitImageToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !templateImage) return;

    const containerRect = container.getBoundingClientRect();
    const padding = 48;

    const availableWidth = containerRect.width - padding * 2;
    const availableHeight = containerRect.height - padding * 2;

    const scaleX = availableWidth / templateImage.width;
    const scaleY = availableHeight / templateImage.height;
    const scale = Math.min(scaleX, scaleY, 1);

    setDisplayScale(scale);

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = Math.floor(templateImage.width * scale);
    const cssHeight = Math.floor(templateImage.height * scale);

    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }, [templateImage, setDisplayScale]);

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
        x: box.x * displayScale,
        y: box.y * displayScale,
        w: box.w * displayScale,
        h: box.h * displayScale,
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
          const displayFontSize = currentFontSize * displayScale;
          ctx.font = `${displayFontSize}px ${fontFamily}`;
          const metrics = ctx.measureText(previewText);
          const textHeight = displayFontSize * 1.2;

          if (metrics.width <= displayBox.w - 10 && textHeight <= displayBox.h - 10) {
            break;
          }
          currentFontSize -= 2;
        }

        const displayFontSize = currentFontSize * displayScale;
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
    [displayScale, previewEnabled, fontPreview]
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !templateImage) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.drawImage(templateImage, 0, 0, cssWidth, cssHeight);

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

    ctx.restore();
  }, [templateImage, boxes, activeBoxId, csvData, drawBox, tempBox, dragMode]);

  const getHandleAtPoint = useCallback(
    (imgX: number, imgY: number): HandleKey | null => {
      const activeBox = boxes.find((b) => b.id === activeBoxId);
      if (!activeBox) return null;

      const handles = getHandlePositions(activeBox);
      const threshold = HANDLE_SIZE / displayScale;

      for (const [key, pos] of Object.entries(handles)) {
        if (Math.abs(imgX - pos.x) < threshold && Math.abs(imgY - pos.y) < threshold) {
          return key as HandleKey;
        }
      }
      return null;
    },
    [boxes, activeBoxId, displayScale]
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!templateImage || !csvFile) return;

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

      const handle = getHandleAtPoint(imgX, imgY);
      if (handle) {
        const activeBox = boxes.find((b) => b.id === activeBoxId);
        if (activeBox) {
          pushState(boxes);
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
          pushState(boxes);
          setDragMode('move');
          setDragStart({ x: imgX, y: imgY });
          setOriginalBox({ ...clickedBox });
        } else {
          setActiveBox(clickedBox.id);
        }
        return;
      }

      setActiveBox(null);
      setDragMode('draw');
      setDragStart({ x: imgX, y: imgY });
      setTempBox({ x: imgX, y: imgY, w: 0, h: 0 });
    },
    [templateImage, csvFile, screenToImage, getHandleAtPoint, getBoxAtPoint, boxes, activeBoxId, setActiveBox, pushState]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!templateImage) return;

      const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

      if (dragMode === 'none') {
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
        return;
      }

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
        let newX = originalBox.x + dx;
        let newY = originalBox.y + dy;
        newX = Math.max(0, Math.min(newX, templateImage.width - originalBox.w));
        newY = Math.max(0, Math.min(newY, templateImage.height - originalBox.h));
        updateBox(originalBox.id, { x: newX, y: newY });
      } else if (dragMode === 'resize' && activeHandle && originalBox) {
        const dx = clampedX - dragStart.x;
        const dy = clampedY - dragStart.y;
        const newBox = { ...originalBox };

        if (activeHandle.includes('w')) {
          newBox.x = originalBox.x + dx;
          newBox.w = originalBox.w - dx;
        }
        if (activeHandle.includes('e')) {
          newBox.w = originalBox.w + dx;
        }
        if (activeHandle.includes('n')) {
          newBox.y = originalBox.y + dy;
          newBox.h = originalBox.h - dy;
        }
        if (activeHandle.includes('s')) {
          newBox.h = originalBox.h + dy;
        }

        if (newBox.w < 20) {
          if (activeHandle.includes('w')) {
            newBox.x = originalBox.x + originalBox.w - 20;
          }
          newBox.w = 20;
        }
        if (newBox.h < 20) {
          if (activeHandle.includes('n')) {
            newBox.y = originalBox.y + originalBox.h - 20;
          }
          newBox.h = 20;
        }

        updateBox(originalBox.id, { x: newBox.x, y: newBox.y, w: newBox.w, h: newBox.h });
      }
    },
    [dragMode, dragStart, originalBox, activeHandle, screenToImage, updateBox, templateImage, getHandleAtPoint, getBoxAtPoint]
  );

  const handleMouseUp = useCallback(() => {
    if (dragMode === 'draw' && tempBox && tempBox.w > 20 && tempBox.h > 20) {
      pushState(boxes);
      addBox(tempBox);
    }
    setDragMode('none');
    setActiveHandle(null);
    setOriginalBox(null);
    setTempBox(null);
  }, [dragMode, tempBox, addBox, pushState, boxes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          const next = redo(boxes);
          if (next) setBoxes(next);
        } else {
          const prev = undo(boxes);
          if (prev) setBoxes(prev);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const next = redo(boxes);
        if (next) setBoxes(next);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && activeBoxId) {
        e.preventDefault();
        pushState(boxes);
        deleteBox(activeBoxId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeBoxId, deleteBox, boxes, undo, redo, setBoxes, pushState]);

  useEffect(() => {
    fitImageToCanvas();
    window.addEventListener('resize', fitImageToCanvas);
    return () => window.removeEventListener('resize', fitImageToCanvas);
  }, [fitImageToCanvas]);

  useEffect(() => {
    render();
  }, [render]);

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
    <div ref={containerRef} className="flex-1 flex flex-col items-center justify-center bg-slate-100 p-6 overflow-hidden relative">
      <canvas
        ref={canvasRef}
        className="bg-white shadow-xl rounded-lg cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        tabIndex={0}
      />

      <div className="mt-4 flex items-center gap-3 bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200">
        <button
          onClick={() => {
            const prev = undo(boxes);
            if (prev) setBoxes(prev);
          }}
          disabled={past.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-40 transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
          <span>Undo</span>
        </button>

        <div className="w-px h-4 bg-slate-200" />

        <button
          onClick={() => {
            const next = redo(boxes);
            if (next) setBoxes(next);
          }}
          disabled={future.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-40 transition-colors"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
          <span>Redo</span>
        </button>

        <div className="w-px h-4 bg-slate-200" />

        <button
          onClick={reset}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-500 hover:text-red-600 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
}
