'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function ResizeHandle() {
  const { setSidebarWidth } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const isResizingRef = useRef(false);

  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      setIsDragging(true);
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
        setIsDragging(false);
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
      className="absolute top-0 -right-[6px] w-3 h-full cursor-col-resize z-20 group flex items-center justify-center select-none"
      title="Drag to resize sidebar"
    >
      {/* Visual border highlight line along full height */}
      <div
        className={`h-full w-[3px] transition-colors duration-150 ${
          isDragging
            ? 'bg-[#727dd8]'
            : 'group-hover:bg-[#727dd8] bg-transparent'
        }`}
      />
    </div>
  );
}
