'use client';

import { useState, useRef, useEffect } from 'react';
import { Trash2, Upload, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { ColorPicker } from './ColorPicker';
import { PRESET_EMBLEMS, drawStyledQr } from '../../lib/qr-renderer';
import type {
  QrZone,
  QrStyleConfig,
  QrBodyShape,
  QrEyeFrameShape,
  QrEyeDotShape,
  QrCenterShape,
} from '../../types';

interface QrCustomizerProps {
  activeQr: QrZone;
}

const BODY_SHAPES: { id: QrBodyShape; label: string; shortLabel: string }[] = [
  { id: 'smooth', label: 'Fluid', shortLabel: 'Fluid' },
  { id: 'rounded-connected', label: 'Rounded', shortLabel: 'Round' },
  { id: 'square', label: 'Square', shortLabel: 'Square' },
  { id: 'horizontal', label: 'Horizontal', shortLabel: 'Horiz' },
  { id: 'vertical', label: 'Vertical', shortLabel: 'Vert' },
  { id: 'classy', label: 'Classy', shortLabel: 'Classy' },
  { id: 'classy-rounded', label: 'Classy Smooth', shortLabel: 'Smooth' },
  { id: 'dots', label: 'Dots', shortLabel: 'Dots' },
  { id: 'extra-rounded', label: 'Squircle', shortLabel: 'Squircle' },
  { id: 'star', label: 'Star', shortLabel: 'Star' },
  { id: 'hexagon', label: 'Hexagon', shortLabel: 'Hex' },
  { id: 'mosaic', label: 'Mosaic', shortLabel: 'Mosaic' },
  { id: 'leaf', label: 'Leaf', shortLabel: 'Leaf' },
  { id: 'diamond', label: 'Diamond', shortLabel: 'Diamond' },
];

const EYE_FRAME_SHAPES: { id: QrEyeFrameShape; label: string; shortLabel: string }[] = [
  { id: 'square', label: 'Square', shortLabel: 'Square' },
  { id: 'rounded', label: 'Rounded', shortLabel: 'Round' },
  { id: 'extra-rounded', label: 'Squircle', shortLabel: 'Squircle' },
  { id: 'circle', label: 'Circle', shortLabel: 'Circle' },
  { id: 'leaf', label: 'Leaf', shortLabel: 'Leaf' },
  { id: 'leaf-inverted', label: 'Leaf Inv', shortLabel: 'Leaf Inv' },
  { id: 'pointed-leaf', label: 'Pointed', shortLabel: 'Pointed' },
  { id: 'shield', label: 'Shield', shortLabel: 'Shield' },
  { id: 'diamond', label: 'Diamond', shortLabel: 'Diamond' },
];

const EYE_DOT_SHAPES: { id: QrEyeDotShape; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'dot', label: 'Dot' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'star', label: 'Star' },
  { id: 'cross', label: 'Cross' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'ring', label: 'Ring' },
];

const CENTER_SHAPES: { id: QrCenterShape; label: string }[] = [
  { id: 'rounded', label: 'Squircle' },
  { id: 'circle', label: 'Circle' },
  { id: 'shield', label: 'Shield' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'square', label: 'Square' },
];

interface StylePreset {
  id: string;
  name: string;
  bodyShape: QrBodyShape;
  eyeFrameShape: QrEyeFrameShape;
  eyeDotShape: QrEyeDotShape;
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'modern-fluid',
    name: 'Modern Fluid',
    bodyShape: 'smooth',
    eyeFrameShape: 'rounded',
    eyeDotShape: 'rounded',
  },
  {
    id: 'royal-seal',
    name: 'Royal Seal',
    bodyShape: 'smooth',
    eyeFrameShape: 'shield',
    eyeDotShape: 'diamond',
  },
  {
    id: 'classy-leaf',
    name: 'Classy Leaf',
    bodyShape: 'classy',
    eyeFrameShape: 'leaf',
    eyeDotShape: 'leaf',
  },
  {
    id: 'modern-squircle',
    name: 'Squircle',
    bodyShape: 'extra-rounded',
    eyeFrameShape: 'extra-rounded',
    eyeDotShape: 'rounded',
  },
  {
    id: 'minimal-dots',
    name: 'Minimal Dots',
    bodyShape: 'dots',
    eyeFrameShape: 'circle',
    eyeDotShape: 'dot',
  },
  {
    id: 'tech-bars',
    name: 'Tech Bar',
    bodyShape: 'horizontal',
    eyeFrameShape: 'extra-rounded',
    eyeDotShape: 'cross',
  },
];

function PresetThumbnail({
  bodyShape,
  eyeFrameShape,
  eyeDotShape,
}: {
  bodyShape: QrBodyShape;
  eyeFrameShape: QrEyeFrameShape;
  eyeDotShape: QrEyeDotShape;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawStyledQr(ctx, {
      x: 2,
      y: 2,
      size: canvas.width - 4,
      text: 'https://certify.app',
      style: {
        bodyShape,
        eyeFrameShape,
        eyeDotShape,
        patternColor: '#1c1917',
        backgroundColor: 'transparent',
      },
    });
  }, [bodyShape, eyeFrameShape, eyeDotShape]);

  return (
    <canvas
      ref={canvasRef}
      width={72}
      height={72}
      className="w-10 h-10 object-contain pointer-events-none"
    />
  );
}

export function QrCustomizer({ activeQr }: QrCustomizerProps) {
  const { boxes, qrZones, updateQrZone, deleteQrZone, setActiveQrId } = useAppStore();
  const { pushState } = useHistoryStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const style: QrStyleConfig = activeQr.style || {
    bodyShape: 'smooth',
    eyeFrameShape: 'rounded',
    eyeDotShape: 'rounded',
    patternColor: '#000000',
    backgroundColor: 'transparent',
    centerShape: 'rounded',
  };

  const [xInput, setXInput] = useState<string>(String(Math.round(activeQr.x)));
  const [yInput, setYInput] = useState<string>(String(Math.round(activeQr.y)));
  const [sizeInput, setSizeInput] = useState<string>(String(Math.round(activeQr.size)));

  const focusedInputRef = useRef<string | null>(null);
  const isInputEditingRef = useRef(false);

  useEffect(() => {
    if (focusedInputRef.current !== 'x') setXInput(String(Math.round(activeQr.x)));
    if (focusedInputRef.current !== 'y') setYInput(String(Math.round(activeQr.y)));
    if (focusedInputRef.current !== 'size') setSizeInput(String(Math.round(activeQr.size)));
  }, [activeQr.x, activeQr.y, activeQr.size, activeQr.id]);

  const startInputEdit = () => {
    if (!isInputEditingRef.current) {
      pushState(boxes, qrZones);
      isInputEditingRef.current = true;
    }
  };

  const finishInputEdit = () => {
    focusedInputRef.current = null;
    isInputEditingRef.current = false;
  };

  const updateStyle = (updates: Partial<QrStyleConfig>) => {
    pushState(boxes, qrZones);
    const newStyle: QrStyleConfig = {
      ...style,
      ...updates,
    };
    updateQrZone(activeQr.id, { style: newStyle });
  };

  const handleDelete = () => {
    pushState(boxes, qrZones);
    deleteQrZone(activeQr.id);
    setActiveQrId(null);
  };

  const handleCustomLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        updateStyle({ logo: dataUrl });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const currentBodyShape =
    style.bodyShape === 'rounded' ? 'rounded-connected' : style.bodyShape || 'smooth';
  const currentEyeFrame = style.eyeFrameShape || 'rounded';
  const currentEyeDot = style.eyeDotShape || 'rounded';
  const currentCenterShape = style.centerShape || 'rounded';
  const currentPatternColor = style.patternColor || '#000000';
  const currentEyeFrameColor = style.eyeFrameColor || currentPatternColor;
  const currentEyeDotColor = style.eyeDotColor || currentPatternColor;
  const currentBgColor = style.backgroundColor || 'transparent';

  const [useCustomEyeFrameColor, setUseCustomEyeFrameColor] = useState(
    Boolean(style.eyeFrameColor && style.eyeFrameColor !== style.patternColor)
  );
  const [useCustomEyeDotColor, setUseCustomEyeDotColor] = useState(
    Boolean(style.eyeDotColor && style.eyeDotColor !== style.patternColor)
  );

  const [hoveredBodyShape, setHoveredBodyShape] = useState<QrBodyShape | null>(null);
  const [hoveredEyeFrame, setHoveredEyeFrame] = useState<QrEyeFrameShape | null>(null);
  const [hoveredEyeDot, setHoveredEyeDot] = useState<QrEyeDotShape | null>(null);

  return (
    <div className="space-y-5 text-stone-900">
      {/* Header & Delete */}
      <div className="flex items-center justify-between pb-3 border-b border-stone-200/80">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-stone-900">QR Code Style</h3>
          <p className="text-xs text-stone-500 font-mono mt-0.5">
            {Math.round(activeQr.size)} × {Math.round(activeQr.size)} px
          </p>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="text-stone-400 hover:text-red-600 transition-colors p-1.5 -mr-1.5 rounded hover:bg-stone-100 cursor-pointer"
          title="Delete QR code"
          aria-label="Delete QR code"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Preset Themes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Style Combinations
          </label>
          <span className="text-[11px] text-stone-400 font-medium">
            1-click design
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {STYLE_PRESETS.map((preset) => {
            const isActive =
              currentBodyShape === preset.bodyShape &&
              currentEyeFrame === preset.eyeFrameShape &&
              currentEyeDot === preset.eyeDotShape;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  updateStyle({
                    bodyShape: preset.bodyShape,
                    eyeFrameShape: preset.eyeFrameShape,
                    eyeDotShape: preset.eyeDotShape,
                  });
                }}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all cursor-pointer outline-none focus:outline-none ${
                  isActive
                    ? 'border-stone-900 bg-stone-100/80 shadow-xs font-semibold text-stone-950'
                    : 'border-stone-200/80 bg-white hover:border-stone-400 hover:bg-stone-50 text-stone-600'
                }`}
                title={preset.name}
              >
                <div className="w-10 h-10 flex items-center justify-center">
                  <PresetThumbnail
                    bodyShape={preset.bodyShape}
                    eyeFrameShape={preset.eyeFrameShape}
                    eyeDotShape={preset.eyeDotShape}
                  />
                </div>
                <span className="text-[11px] truncate w-full text-center mt-1.5 leading-tight">
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. Body Pattern Shapes */}
      <div className="pt-4 border-t border-stone-200/70">
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Body Pattern
          </label>
          <span className="text-xs font-medium text-stone-800 font-mono transition-colors">
            {hoveredBodyShape
              ? BODY_SHAPES.find((s) => s.id === hoveredBodyShape)?.label
              : BODY_SHAPES.find((s) => s.id === currentBodyShape)?.label}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {BODY_SHAPES.map(({ id, label }) => {
            const isSelected = currentBodyShape === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => updateStyle({ bodyShape: id })}
                onMouseEnter={() => setHoveredBodyShape(id)}
                onMouseLeave={() => setHoveredBodyShape(null)}
                title={label}
                className={`aspect-square flex items-center justify-center rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                    : 'border-stone-200/70 bg-stone-50/50 text-stone-700 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  {id === 'square' && (
                    <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
                      <div className={`w-1.5 h-1.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'rounded-connected' && (
                    <div className="grid grid-cols-2 w-4 h-4 rounded-xs overflow-hidden">
                      <div className={`w-2 h-2 rounded-tl-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-tr-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-bl-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-br-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'smooth' && (
                    <div className="grid grid-cols-2 w-4.5 h-4.5">
                      <div className={`w-2.25 h-2.25 rounded-tl-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2.25 h-2.25 rounded-tr-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2.25 h-2.25 rounded-bl-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2.25 h-2.25 rounded-br-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'dots' && (
                    <div className="grid grid-cols-2 gap-1 w-4 h-4">
                      <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'extra-rounded' && (
                    <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
                      <div className={`w-1.5 h-1.5 rounded-[3px] ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-[3px] ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-[3px] ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-[3px] ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'classy' && (
                    <div className="grid grid-cols-2 w-4 h-4">
                      <div className={`w-2 h-2 rounded-tl-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-br-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'classy-rounded' && (
                    <div className="grid grid-cols-2 w-4 h-4">
                      <div className={`w-2 h-2 rounded-tl-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-tr-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-bl-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-2 h-2 rounded-br-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'horizontal' && (
                    <div className="flex flex-col justify-between w-4.5 h-4 py-0.5">
                      <div className={`w-4.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-3.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'vertical' && (
                    <div className="flex justify-between w-4 h-4.5 px-0.5">
                      <div className={`w-1.5 h-4.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-3.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'star' && (
                    <svg viewBox="0 0 16 16" className="w-4.5 h-4.5" fill={isSelected ? '#ffffff' : '#292524'}>
                      <path d="M8 0 Q8 8 16 8 Q8 8 8 16 Q8 8 0 8 Q8 8 8 0 Z" />
                    </svg>
                  )}
                  {id === 'hexagon' && (
                    <svg viewBox="0 0 16 16" className="w-4.5 h-4.5" fill={isSelected ? '#ffffff' : '#292524'}>
                      <polygon points="8,1 15,5 15,11 8,15 1,11 1,5" />
                    </svg>
                  )}
                  {id === 'mosaic' && (
                    <div className="grid grid-cols-2 gap-1 w-4 h-4">
                      <div className={`w-1.5 h-1.5 rounded-2xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-2xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-2xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-2xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'leaf' && (
                    <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
                      <div className={`w-1.5 h-1.5 rounded-tl-md rounded-br-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-tl-md rounded-br-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-tl-md rounded-br-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rounded-tl-md rounded-br-md ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                  {id === 'diamond' && (
                    <div className="grid grid-cols-2 gap-1 w-4 h-4 items-center justify-center">
                      <div className={`w-1.5 h-1.5 rotate-45 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rotate-45 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rotate-45 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      <div className={`w-1.5 h-1.5 rotate-45 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Corner Eye Frame & Dot Style */}
      <div className="pt-4 border-t border-stone-200/70 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Corner Eye Frame
            </label>
            <span className="text-xs font-medium text-stone-800 font-mono transition-colors">
              {hoveredEyeFrame
                ? EYE_FRAME_SHAPES.find((f) => f.id === hoveredEyeFrame)?.label
                : EYE_FRAME_SHAPES.find((f) => f.id === currentEyeFrame)?.label}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {EYE_FRAME_SHAPES.map(({ id, label }) => {
              const isSelected = currentEyeFrame === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateStyle({ eyeFrameShape: id })}
                  onMouseEnter={() => setHoveredEyeFrame(id)}
                  onMouseLeave={() => setHoveredEyeFrame(null)}
                  title={label}
                  className={`aspect-square flex items-center justify-center rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                      : 'border-stone-200/70 bg-stone-50/50 text-stone-700 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center">
                    {id === 'square' && (
                      <div className={`w-4 h-4 border-2 ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'rounded' && (
                      <div className={`w-4 h-4 border-2 rounded-xs ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'extra-rounded' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-[5px] ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'circle' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-full ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'leaf' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-tl-md rounded-br-md ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'leaf-inverted' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-tr-md rounded-bl-md ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'pointed-leaf' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-tr-md rounded-br-md rounded-bl-md ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'shield' && (
                      <div className={`w-4.5 h-4.5 border-2 rounded-b-md ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                    {id === 'diamond' && (
                      <div className={`w-3.5 h-3.5 border-2 rotate-45 ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Corner Eye Center
            </label>
            <span className="text-xs font-medium text-stone-800 font-mono transition-colors">
              {hoveredEyeDot
                ? EYE_DOT_SHAPES.find((d) => d.id === hoveredEyeDot)?.label
                : EYE_DOT_SHAPES.find((d) => d.id === currentEyeDot)?.label}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {EYE_DOT_SHAPES.map(({ id, label }) => {
              const isSelected = currentEyeDot === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateStyle({ eyeDotShape: id })}
                  onMouseEnter={() => setHoveredEyeDot(id)}
                  onMouseLeave={() => setHoveredEyeDot(null)}
                  title={label}
                  className={`h-11 flex items-center justify-center rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                      : 'border-stone-200/70 bg-stone-50/50 text-stone-700 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center">
                    {id === 'square' && (
                      <div className={`w-2.5 h-2.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    )}
                    {id === 'dot' && (
                      <div className={`w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    )}
                    {id === 'rounded' && (
                      <div className={`w-2.5 h-2.5 rounded-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    )}
                    {id === 'diamond' && (
                      <div className={`w-2.5 h-2.5 rotate-45 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    )}
                    {id === 'star' && (
                      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill={isSelected ? '#ffffff' : '#292524'}>
                        <path d="M8 0 Q8 8 16 8 Q8 8 8 16 Q8 8 0 8 Q8 8 8 0 Z" />
                      </svg>
                    )}
                    {id === 'cross' && (
                      <div className="relative w-3.5 h-3.5 flex items-center justify-center">
                        <div className={`absolute w-3.5 h-1 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                        <div className={`absolute w-1 h-3.5 ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                      </div>
                    )}
                    {id === 'leaf' && (
                      <div className={`w-2.5 h-2.5 rounded-tl-xs rounded-br-xs ${isSelected ? 'bg-white' : 'bg-stone-800'}`} />
                    )}
                    {id === 'ring' && (
                      <div className={`w-3.5 h-3.5 rounded-full border-2 ${isSelected ? 'border-white' : 'border-stone-800'}`} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Color Customization */}
      <div className="pt-3 border-t border-stone-200/80 space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-2">
            Pattern Color
          </label>
          <ColorPicker
            value={currentPatternColor}
            onChange={(color) => {
              const updates: Partial<QrStyleConfig> = { patternColor: color };
              if (!useCustomEyeFrameColor) updates.eyeFrameColor = color;
              if (!useCustomEyeDotColor) updates.eyeDotColor = color;
              updateStyle(updates);
            }}
            onStartEdit={() => pushState(boxes, qrZones)}
          />
        </div>

        {/* Eye Frame Color */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700">Eye Frame Color</span>
            <button
              type="button"
              onClick={() => {
                const next = !useCustomEyeFrameColor;
                setUseCustomEyeFrameColor(next);
                if (!next) {
                  updateStyle({ eyeFrameColor: currentPatternColor });
                }
              }}
              className="text-[11px] text-stone-500 hover:text-stone-900 underline underline-offset-2"
            >
              {useCustomEyeFrameColor ? 'Match pattern' : 'Custom'}
            </button>
          </div>
          {useCustomEyeFrameColor && (
            <ColorPicker
              value={currentEyeFrameColor}
              onChange={(color) => updateStyle({ eyeFrameColor: color })}
              onStartEdit={() => pushState(boxes, qrZones)}
            />
          )}
        </div>

        {/* Eye Center Dot Color */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700">Eye Center Color</span>
            <button
              type="button"
              onClick={() => {
                const next = !useCustomEyeDotColor;
                setUseCustomEyeDotColor(next);
                if (!next) {
                  updateStyle({ eyeDotColor: currentPatternColor });
                }
              }}
              className="text-[11px] text-stone-500 hover:text-stone-900 underline underline-offset-2"
            >
              {useCustomEyeDotColor ? 'Match pattern' : 'Custom'}
            </button>
          </div>
          {useCustomEyeDotColor && (
            <ColorPicker
              value={currentEyeDotColor}
              onChange={(color) => updateStyle({ eyeDotColor: color })}
              onStartEdit={() => pushState(boxes, qrZones)}
            />
          )}
        </div>

        {/* Background Color */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700">Background</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateStyle({ backgroundColor: 'transparent' })}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  currentBgColor === 'transparent'
                    ? 'bg-stone-900 text-white font-medium'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                Transparent
              </button>
              <button
                type="button"
                onClick={() => updateStyle({ backgroundColor: '#FFFFFF' })}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  currentBgColor !== 'transparent'
                    ? 'bg-stone-900 text-white font-medium'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                Solid
              </button>
            </div>
          </div>
          {currentBgColor !== 'transparent' && (
            <ColorPicker
              value={currentBgColor}
              onChange={(color) => updateStyle({ backgroundColor: color })}
              onStartEdit={() => pushState(boxes, qrZones)}
            />
          )}
        </div>
      </div>

      {/* 4. Center Logo / Emblem */}
      <div className="pt-4 border-t border-stone-200/70 space-y-3.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500">
            Center Emblem / Logo
          </label>
          {style.logo && (
            <button
              type="button"
              onClick={() => updateStyle({ logo: undefined })}
              className="text-xs text-red-600 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              Remove
            </button>
          )}
        </div>

        {/* Preset Badges */}
        <div className="grid grid-cols-6 gap-2">
          <button
            type="button"
            onClick={() => updateStyle({ logo: undefined })}
            className={`aspect-square flex items-center justify-center rounded-xl border transition-all text-center cursor-pointer ${
              !style.logo
                ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                : 'border-stone-200/70 bg-stone-50/50 text-stone-600 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900'
            }`}
            title="None"
          >
            <span className="text-xs font-semibold">None</span>
          </button>

          {PRESET_EMBLEMS.map((emblem) => {
            const isSelected = style.logo === emblem.svgDataUri;
            return (
              <button
                key={emblem.id}
                type="button"
                onClick={() => updateStyle({ logo: emblem.svgDataUri })}
                className={`aspect-square flex items-center justify-center rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-stone-900 ring-2 ring-stone-900 bg-white shadow-xs'
                    : 'border-stone-200/70 bg-stone-50/50 hover:border-stone-400 hover:bg-stone-100'
                }`}
                title={emblem.name}
              >
                <img
                  src={emblem.svgDataUri}
                  alt={emblem.name}
                  className="w-5 h-5 object-contain"
                />
              </button>
            );
          })}
        </div>

        {/* Custom Logo Upload */}
        <div className="pt-0.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={handleCustomLogoUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 border border-stone-200/80 rounded-xl text-xs font-medium text-stone-700 bg-stone-50/50 hover:bg-stone-100 hover:border-stone-300 transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-stone-500" />
            <span>Upload Custom Icon / Logo</span>
          </button>
        </div>

        {/* Center Cutout Shape */}
        {style.logo && (
          <div className="pt-2">
            <span className="block text-xs font-medium text-stone-700 mb-2">
              Cutout Badge Shape ({CENTER_SHAPES.length} Options)
            </span>
            <div className="grid grid-cols-5 gap-2">
              {CENTER_SHAPES.map(({ id, label }) => {
                const isSelected = currentCenterShape === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateStyle({ centerShape: id })}
                    className={`py-2 px-1 rounded-xl border text-xs font-medium transition-all text-center truncate cursor-pointer ${
                      isSelected
                        ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                        : 'border-stone-200/70 bg-stone-50/50 text-stone-700 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. Size & Position Coordinates */}
      <div className="pt-4 border-t border-stone-200/70 space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600">
          Position & Size
        </label>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-mono uppercase text-stone-500 mb-1">
              X (px)
            </label>
            <input
              type="number"
              value={xInput}
              onFocus={() => {
                focusedInputRef.current = 'x';
                startInputEdit();
              }}
              onChange={(e) => {
                setXInput(e.target.value);
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) updateQrZone(activeQr.id, { x: Math.max(0, val) });
              }}
              onBlur={finishInputEdit}
              className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs font-mono text-stone-900 bg-white focus:outline-none focus:border-stone-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-stone-500 mb-1">
              Y (px)
            </label>
            <input
              type="number"
              value={yInput}
              onFocus={() => {
                focusedInputRef.current = 'y';
                startInputEdit();
              }}
              onChange={(e) => {
                setYInput(e.target.value);
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) updateQrZone(activeQr.id, { y: Math.max(0, val) });
              }}
              onBlur={finishInputEdit}
              className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs font-mono text-stone-900 bg-white focus:outline-none focus:border-stone-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-stone-500 mb-1">
              Size (px)
            </label>
            <input
              type="number"
              value={sizeInput}
              min="40"
              onFocus={() => {
                focusedInputRef.current = 'size';
                startInputEdit();
              }}
              onChange={(e) => {
                setSizeInput(e.target.value);
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 30) updateQrZone(activeQr.id, { size: val });
              }}
              onBlur={finishInputEdit}
              className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs font-mono text-stone-900 bg-white focus:outline-none focus:border-stone-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
