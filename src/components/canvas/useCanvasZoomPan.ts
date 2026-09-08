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
    const fitScale = Math.min(scaleX, scaleY, 1);

    setBaseFitScale(fitScale);
  }, [templateImage, containerRef]);

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
    [zoom, pan, containerRef]
  );

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
        // Shift + Wheel = Horizontal Scroll
        // On macOS, the browser automatically translates Shift + vertical wheel into deltaX.
        // On Windows/Linux, some browsers keep deltaY and leave deltaX = 0.
        // We pick whichever delta has non-zero magnitude to guarantee horizontal scrolling across all platforms.
        const horizontalDelta = Math.abs(normX) > 0 ? normX : normY;
        setPan((prev) => ({
          x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - horizontalDelta)),
          y: prev.y,
        }));
      } else {
        // Standard 2D pan: handles vertical wheel, horizontal tilt wheel, and fluid diagonal trackpad gestures
        setPan((prev) => ({
          x: Math.max(-maxPanX, Math.min(maxPanX, prev.x - normX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, prev.y - normY)),
        }));
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
        initialTouchZoom = zoom;
        initialTouchPan = { ...pan };
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

        const currentMid = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const midDiffX = currentMid.x - initialMidpoint.x;
        const midDiffY = currentMid.y - initialMidpoint.y;

        setZoom(targetZoom);
        setPan({
          x: initialTouchPan.x + midDiffX,
          y: initialTouchPan.y + midDiffY,
        });
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
  }, [zoom, pan, effectiveScale, templateImage, handleZoomChange, containerRef]);

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
      // Ignore when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
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
        handleZoomChange(zoom + 0.25);
      }

      // Ctrl/Cmd + Minus: Zoom Out
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleZoomChange(zoom - 0.25);
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
  }, [zoom, canvasRef, handleResetFit, handleZoomChange, onUndo, onRedo, onDeleteActive, onEscape, onArrowNudge, isDrawingEnabled]);

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
