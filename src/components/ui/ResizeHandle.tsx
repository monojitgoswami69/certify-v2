'use client';

import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function ResizeHandle() {
  const { setSidebarWidth } = useAppStore();
  const isResizingRef = useRef(false);

  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const newWidth = Math.min(
          Math.max(320, moveEvent.clientX),
          Math.min(800, window.innerWidth * 0.65)
        );
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [setSidebarWidth]
  );

  return (
    <div
      onMouseDown={startResizing}
      className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-primary-500/20 active:bg-primary-500/40 transition-colors z-30 group flex items-center justify-center -mr-1"
      title="Drag to resize sidebar"
    >
      <div className="w-1 h-8 rounded-full bg-slate-300 group-hover:bg-primary-500 transition-colors" />
    </div>
  );
}
