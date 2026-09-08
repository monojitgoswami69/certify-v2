'use client';

import React from 'react';
import { Undo2, Redo2, ZoomOut, ZoomIn, ChevronUp, Maximize2, RotateCcw } from 'lucide-react';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_PRESETS } from './useCanvasZoomPan';

export interface CanvasToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetFit: () => void;
  isZoomMenuOpen: boolean;
  setIsZoomMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  zoomMenuRef: React.RefObject<HTMLDivElement | null>;
  onResetLayout: () => void;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomChange,
  onResetFit,
  isZoomMenuOpen,
  setIsZoomMenuOpen,
  zoomMenuRef,
  onResetLayout,
}) => {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl+';

  return (
    <div className="absolute bottom-6 flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl shadow-xl border border-slate-400 text-slate-800 text-xs font-medium z-30">
      {/* Undo / Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
          title={`Undo (${modKey}Z)`}
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
          title={`Redo (${modKey}${isMac ? '⇧Z' : 'Y'})`}
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      <div className="w-px h-5 bg-slate-300" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onZoomChange(zoom - 0.25)}
          disabled={zoom <= MIN_ZOOM}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
          title={`Zoom Out (${modKey}-)`}
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* Zoom Preset Selector Dropdown */}
        <div className="relative" ref={zoomMenuRef}>
          <button
            onClick={() => setIsZoomMenuOpen((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg font-semibold min-w-[54px] justify-center font-mono text-xs transition-colors cursor-pointer"
            title="Click to select Zoom level"
          >
            <span>{Math.round(zoom * 100)}%</span>
            <ChevronUp
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isZoomMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isZoomMenuOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col bg-white border border-slate-300 rounded-xl shadow-2xl py-1.5 w-32 text-center z-50">
              <button
                onClick={onResetFit}
                className="px-3 py-1.5 hover:bg-violet-50 hover:text-violet-700 text-left text-xs font-semibold text-slate-700 transition-colors"
              >
                Fit Screen
              </button>
              <div className="h-px bg-slate-200 my-1" />
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    onZoomChange(preset);
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
          onClick={() => onZoomChange(zoom + 0.25)}
          disabled={zoom >= MAX_ZOOM}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-slate-950 rounded-lg disabled:opacity-25 transition-colors"
          title={`Zoom In (${modKey}+)`}
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          onClick={onResetFit}
          className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition-colors"
          title={`Fit to Viewport (${modKey}0)`}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-px h-5 bg-slate-300" />

      {/* Reset Canvas Button */}
      <button
        onClick={onResetLayout}
        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
        title="Reset Layout (Remove all boxes & reset zoom)"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
    </div>
  );
};
