'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;

interface UseCanvasZoomPanProps {
  templateImage: HTMLImageElement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onUndo?: () => void;
  onRedo?: () => void;
  onDeleteActive?: () => void;
  onArrowNudge?: (dx: number, dy: number) => void;
  onEscape?: () => void;
  isDrawingEnabled?: boolean;
}

export function useCanvasZoomPan({
  templateImage,
  containerRef,
  canvasRef,
  onUndo,
  onRedo,
  onDeleteActive,
  onArrowNudge,
  onEscape,
  isDrawingEnabled = false,
}: UseCanvasZoomPanProps) {
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  const [baseFitScale, setBaseFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);

  const effectiveScale = baseFitScale * zoom;

  // Latest-value refs so the wheel/touch/keyboard listeners stay mounted once
  // instead of being torn down and re-added on every zoom/pan tick (which
  // re-registered 8 listeners per animation frame during pinch-zoom).
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const effectiveScaleRef = useRef(effectiveScale);
  const handleZoomChangeRef = useRef<(z: number, origin?: { x: number; y: number }) => void>(() => {});

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
    [effectiveScale, canvasRef]
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
    const fitScale = Math.min(scaleX, scaleY);

    setBaseFitScale(fitScale);
  }, [templateImage, containerRef]);

  // Reset to initial Fit view
  const handleResetFit = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsZoomMenuOpen(false);
    fitImageToCanvas();
  }, [fitImageToCanvas]);

  // Handle Zoom change (reads synchronous zoomRef/panRef so rapid wheel events never drop deltas)
  const handleZoomChange = useCallback(
    (newZoom: number, originScreenPoint?: { x: number; y: number }) => {
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (clampedZoom <= 1.0) {
        zoomRef.current = clampedZoom;
        panRef.current = { x: 0, y: 0 };
        setZoom(clampedZoom);
        setPan({ x: 0, y: 0 });
        return;
      }

      if (!originScreenPoint || !containerRef.current) {
        zoomRef.current = clampedZoom;
        setZoom(clampedZoom);
        return;
      }

      const prevZoom = zoomRef.current;
      const prevPan = panRef.current;
      const containerRect = containerRef.current.getBoundingClientRect();
      const mouseOffset = {
        x: originScreenPoint.x - (containerRect.left + containerRect.width / 2) - prevPan.x,
        y: originScreenPoint.y - (containerRect.top + containerRect.height / 2) - prevPan.y,
      };

      const scaleRatio = clampedZoom / prevZoom;
      const newPan = {
        x: prevPan.x - mouseOffset.x * (scaleRatio - 1),
        y: prevPan.y - mouseOffset.y * (scaleRatio - 1),
      };

      zoomRef.current = clampedZoom;
      panRef.current = newPan;
      setZoom(clampedZoom);
      setPan(newPan);
    },
    [containerRef]
  );

  // Keep the latest zoom/pan/handler available to the stable listeners below.
  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
    effectiveScaleRef.current = effectiveScale;
    handleZoomChangeRef.current = handleZoomChange;
  }, [zoom, pan, effectiveScale, handleZoomChange]);

  // Auto-fit on template change
  useEffect(() => {
    if (templateImage) {
      handleResetFit();
    }
  }, [templateImage, handleResetFit]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      fitImageToCanvas();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitImageToCanvas]);

  // Native wheel handler for smooth trackpad pan, shift scroll, and Ctrl/Cmd zoom
  // Normalizes deltaMode across Windows physical mice, macOS trackpads, and Linux/Firefox
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !templateImage) return;

    const handleWheel = (e: WheelEvent) => {
      // Delta mode normalization:
      // DOM_DELTA_LINE = 1 (Windows/Linux physical notched mouse, Firefox on all OSes, typical delta is 1-3 lines)
      // DOM_DELTA_PAGE = 2 (Page scrolling)
      // DOM_DELTA_PIXEL = 0 (macOS precision trackpad, smooth gesture wheels, typical delta is 10-60 pixels)
      const lineMultiplier = 20;
      const pageMultiplier = 400;
      const factor =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? lineMultiplier
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? pageMultiplier
          : 1;

      const normX = e.deltaX * factor;
      const normY = e.deltaY * factor;

      // 1. Ctrl / Cmd + Wheel: Zoom in / out centered at mouse
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = -normY * 0.003;
        const targetZoom = zoomRef.current * (1 + zoomDelta);
        handleZoomChangeRef.current(targetZoom, { x: e.clientX, y: e.clientY });
        return;
      }

      // 2. If zoom <= 1.0 (certificate is completely visible on screen), disable scrolling
      if (zoomRef.current <= 1.0) {
        return;
      }

      // 3. Zoom > 1.0: Scrolling is enabled
      e.preventDefault();

      const containerRect = container.getBoundingClientRect();
      const cssWidth = templateImage.width * effectiveScaleRef.current;
      const cssHeight = templateImage.height * effectiveScaleRef.current;

      const maxPanX = Math.max(0, (cssWidth - containerRect.width) / 2 + 100);
      const maxPanY = Math.max(0, (cssHeight - containerRect.height) / 2 + 100);

      if (e.shiftKey) {
        // Shift + Wheel = Horizontal Scroll
        const horizontalDelta = Math.abs(normX) > 0 ? normX : normY;
        setPan((prev) => {
          const next = {
            x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - horizontalDelta)),
            y: prev.y,
          };
          panRef.current = next;
          return next;
        });
      } else {
        // Standard 2D pan: handles vertical wheel, horizontal tilt wheel, and fluid diagonal trackpad gestures
        setPan((prev) => {
          const next = {
            x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - normX)),
            y: Math.max(-maxPanY, Math.min(maxPanY, prev.y - normY)),
          };
          panRef.current = next;
          return next;
        });
      }
    };

    // Touch gesture handling for tablets and touchscreen laptops (iPad, Surface Pro, 2-in-1 devices)
    let initialTouchDist = 0;
    let initialTouchZoom = 1;
    let initialTouchPan = { x: 0, y: 0 };
    let initialMidpoint = { x: 0, y: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialTouchZoom = zoomRef.current;
        initialTouchPan = { ...panRef.current };
        initialMidpoint = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialTouchDist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scaleChange = currentDist / initialTouchDist;
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialTouchZoom * scaleChange));

        if (targetZoom <= 1.0) {
          zoomRef.current = targetZoom;
          panRef.current = { x: 0, y: 0 };
          setZoom(targetZoom);
          setPan({ x: 0, y: 0 });
          return;
        }

        const currentMid = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const containerRect = container.getBoundingClientRect();
        const midOffset = {
          x: initialMidpoint.x - (containerRect.left + containerRect.width / 2) - initialTouchPan.x,
          y: initialMidpoint.y - (containerRect.top + containerRect.height / 2) - initialTouchPan.y,
        };
        const ratio = targetZoom / initialTouchZoom;
        const nextPan = {
          x: initialTouchPan.x - midOffset.x * (ratio - 1) + (currentMid.x - initialMidpoint.x),
          y: initialTouchPan.y - midOffset.y * (ratio - 1) + (currentMid.y - initialMidpoint.y),
        };

        zoomRef.current = targetZoom;
        panRef.current = nextPan;
        setZoom(targetZoom);
        setPan(nextPan);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialTouchDist = 0;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [templateImage, containerRef]);

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
        canvasRef.current.style.cursor = isDrawingEnabled ? 'crosshair' : 'default';
      }
    };

    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleBlur);
    };
  }, [canvasRef, isDrawingEnabled]);

  // Keyboard shortcut listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in form controls or while a modal dialog is open above the canvas
      const target = e.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        Boolean(target.closest('[aria-modal="true"], dialog[open]')) ||
        Boolean(document.querySelector('[aria-modal="true"], dialog[open]'))
      ) {
        return;
      }

      // Spacebar toggles pan mode
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = 'grab';
        }
      }

      // Ctrl/Cmd + 0: Fit to Viewport
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleResetFit();
      }

      // Ctrl/Cmd + Plus: Zoom In
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomChangeRef.current(zoomRef.current + 0.25);
      }

      // Ctrl/Cmd + Minus: Zoom Out
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleZoomChangeRef.current(zoomRef.current - 0.25);
      }

      // Ctrl/Cmd + Z: Undo (supports international keyboard layouts like QWERTZ / AZERTY)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key?.toLowerCase() === 'z' || e.code === 'KeyZ')
      ) {
        e.preventDefault();
        onUndo?.();
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y: Redo
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key?.toLowerCase() === 'z' || e.code === 'KeyZ')) ||
        ((e.ctrlKey || e.metaKey) && (e.key?.toLowerCase() === 'y' || e.code === 'KeyY'))
      ) {
        e.preventDefault();
        onRedo?.();
      }

      // Delete / Backspace: Delete active element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onDeleteActive?.();
      }

      // Escape: Deselect / cancel
      if (e.key === 'Escape') {
        onEscape?.();
      }

      // Arrow keys: Nudge active element
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          onArrowNudge?.(dx, dy);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = isDrawingEnabled ? 'crosshair' : 'default';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [canvasRef, handleResetFit, onUndo, onRedo, onDeleteActive, onEscape, onArrowNudge, isDrawingEnabled]);

  return {
    zoom,
    pan,
    setPan,
    baseFitScale,
    effectiveScale,
    isSpacePressed,
    setIsSpacePressed,
    isZoomMenuOpen,
    setIsZoomMenuOpen,
    zoomMenuRef,
    screenToImage,
    handleResetFit,
    handleZoomChange,
    fitImageToCanvas,
  };
}
