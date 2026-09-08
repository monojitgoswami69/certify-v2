'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Pipette, Check } from 'lucide-react';

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  onStartEdit?: () => void;
  onFinishEdit?: () => void;
  className?: string;
}

// 12 curated, elegant certificate inks and foil tones
const PRESET_SWATCHES = [
  { name: 'Pitch Black', hex: '#000000' },
  { name: 'Deep Slate', hex: '#0F172A' },
  { name: 'Slate Gray', hex: '#334155' },
  { name: 'Muted Slate', hex: '#64748B' },
  { name: 'Royal Navy', hex: '#1E3A8A' },
  { name: 'Classic Blue', hex: '#2563EB' },
  { name: 'Deep Forest', hex: '#064E3B' },
  { name: 'Emerald', hex: '#047857' },
  { name: 'Imperial Gold', hex: '#B45309' },
  { name: 'Warm Amber', hex: '#D97706' },
  { name: 'Dark Bronze', hex: '#78350F' },
  { name: 'Burgundy', hex: '#881337' },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    switch (max) {
      case rNorm:
        h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) * 60;
        break;
      case gNorm:
        h = ((bNorm - rNorm) / d + 2) * 60;
        break;
      case bNorm:
        h = ((rNorm - gNorm) / d + 4) * 60;
        break;
    }
  }

  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function ColorPicker({
  value,
  onChange,
  onStartEdit,
  onFinishEdit,
  className = '',
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);

  // Internal HSV representation
  const [hue, setHue] = useState(0); // 0..360
  const [sat, setSat] = useState(1); // 0..1
  const [val, setVal] = useState(1); // 0..1

  // Local text input state for HEX
  const [hexInput, setHexInput] = useState(value.replace('#', '').toUpperCase());

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const satValBoxRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);

  // Sync internal representations from external `value` prop
  useEffect(() => {
    const rgb = hexToRgb(value);
    if (!rgb) return;

    const targetHex = (value.startsWith('#') ? value : `#${value}`).toUpperCase();
    const currentHex = hsvToHex(hue, sat, val).toUpperCase();

    setHexInput(targetHex.replace('#', ''));

    if (currentHex === targetHex) return;

    const [hHsv, sHsv, vHsv] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    if (sHsv > 0.01 && vHsv > 0.01) {
      setHue(hHsv);
    }
    setSat(sHsv);
    setVal(vHsv);
  }, [value]);

  // High-DPI, vector-antialiased canvas drawing for 2D Saturation/Value surface
  const drawSurface = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 232;
    const height = canvas.clientHeight || 128;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    const radius = 8;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, width, height, radius);
    } else {
      ctx.moveTo(radius, 0);
      ctx.lineTo(width - radius, 0);
      ctx.quadraticCurveTo(width, 0, width, radius);
      ctx.lineTo(width, height - radius);
      ctx.quadraticCurveTo(width, height, width - radius, height);
      ctx.lineTo(radius, height);
      ctx.quadraticCurveTo(0, height, 0, height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
    }
    ctx.clip();

    // 1. Base Hue
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(0, 0, width, height);

    // 2. White Horizontal Gradient (Saturation)
    const gradWhite = ctx.createLinearGradient(0, 0, width, 0);
    gradWhite.addColorStop(0, '#ffffff');
    gradWhite.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradWhite;
    ctx.fillRect(0, 0, width, height);

    // 3. Black Vertical Gradient (Brightness)
    const gradBlack = ctx.createLinearGradient(0, height, 0, 0);
    gradBlack.addColorStop(0, '#000000');
    gradBlack.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradBlack;
    ctx.fillRect(0, 0, width, height);

    // 4. Hairline crisp inner stroke
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }, [hue]);

  // Keep canvas sharp with ResizeObserver on popover display
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawSurface();

    const ro = new ResizeObserver(() => {
      drawSurface();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [isOpen, drawSurface]);

  // Outside click & dropUp calculation
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 340 && rect.top > spaceBelow);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onFinishEdit?.();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onFinishEdit]);

  // Saturation / Value 2D dragging
  const handleSatValPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    onStartEdit?.();
    const box = satValBoxRef.current;
    if (!box) return;

    const updateFromEvent = (clientX: number, clientY: number) => {
      const rect = box.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      setSat(s);
      setVal(v);
      const newHex = hsvToHex(hue, s, v);
      onChange(newHex);
    };

    updateFromEvent(e.clientX, e.clientY);

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateFromEvent(moveEvent.clientX, moveEvent.clientY);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      onFinishEdit?.();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Hue slider dragging
  const handleHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    onStartEdit?.();
    const slider = hueSliderRef.current;
    if (!slider) return;

    const updateFromEvent = (clientX: number) => {
      const rect = slider.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newHue = fraction * 360;
      setHue(newHue);
      const newHex = hsvToHex(newHue, sat, val);
      onChange(newHex);
    };

    updateFromEvent(e.clientX);

    const onPointerMove = (moveEvent: PointerEvent) => {
      updateFromEvent(moveEvent.clientX);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      onFinishEdit?.();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Hex Input Change Handler
  const handleHexChange = (str: string) => {
    const cleaned = str.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6).toUpperCase();
    setHexInput(cleaned);
    if (cleaned.length === 3 || cleaned.length === 6) {
      const rgb = hexToRgb(cleaned);
      if (rgb) {
        onStartEdit?.();
        onChange(rgbToHex(rgb[0], rgb[1], rgb[2]));
      }
    }
  };

  const handleHexBlur = () => {
    setHexInput(value.replace('#', '').toUpperCase());
    onFinishEdit?.();
  };

  // System EyeDropper API (Chromium / Edge / Opera)
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const handlePickEyeDropper = async () => {
    if (!hasEyeDropper) return;
    try {
      // @ts-expect-error - EyeDropper API is available in modern browsers
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        const pickedHex = result.sRGBHex.toUpperCase();
        onStartEdit?.();
        onChange(pickedHex);
      }
    } catch {
      // User cancelled eye dropper selection
    }
  };

  const currentHexDisplay = (value.startsWith('#') ? value : `#${value}`).toUpperCase();

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          if (!isOpen) onStartEdit?.();
          else onFinishEdit?.();
          setIsOpen(!isOpen);
        }}
        className={`w-full h-[38px] px-2.5 py-1.5 bg-white border flex items-center justify-between gap-2 transition-colors cursor-pointer focus:outline-none ${
          isOpen
            ? dropUp
              ? 'rounded-t-none rounded-b-lg border-slate-400 border-t-slate-200 shadow-sm'
              : 'rounded-b-none rounded-t-lg border-slate-400 border-b-slate-200 shadow-sm'
            : 'rounded-lg border-slate-200 hover:border-slate-300 focus:border-slate-400'
        }`}
        title="Choose color"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Crisp, non-blurry swatch preview with razor-sharp inset ring */}
          <div
            className="w-5 h-5 rounded-md ring-1 ring-inset ring-black/10 flex-shrink-0"
            style={{ backgroundColor: value }}
          />
          <span className="font-tomorrow text-xs font-semibold text-slate-700 tracking-wider truncate">
            {currentHexDisplay}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className={`absolute z-[100] right-0 ${
            dropUp
              ? 'bottom-full mb-0 rounded-t-xl rounded-br-none border border-slate-400'
              : 'top-full mt-0 rounded-b-xl rounded-tr-none border border-slate-400'
          } w-64 max-w-[calc(100vw-2rem)] bg-white shadow-xl p-3 space-y-3 animate-in fade-in duration-100`}
        >
          {/* 2D Saturation / Value Surface via Retina Canvas */}
          <div
            ref={satValBoxRef}
            onPointerDown={handleSatValPointerDown}
            className="relative w-full h-32 select-none touch-none cursor-crosshair"
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block rounded-lg pointer-events-none"
            />
            {/* Pointer Thumb (circular ring with subtle drop shadow) */}
            <div
              className="w-4 h-4 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-transform duration-75"
              style={{
                left: `${Math.max(0, Math.min(100, sat * 100))}%`,
                top: `${Math.max(0, Math.min(100, (1 - val) * 100))}%`,
                backgroundColor: currentHexDisplay,
              }}
            />
          </div>

          {/* Hue Rainbow Slider */}
          <div className="relative flex items-center px-0.5">
            <div
              ref={hueSliderRef}
              onPointerDown={handleHuePointerDown}
              className="w-full h-3 rounded-full relative cursor-pointer select-none touch-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)] ring-1 ring-black/5"
              style={{
                background:
                  'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
              }}
            >
              {/* Hue Thumb */}
              <div
                className="w-4 h-4 rounded-full bg-white border border-slate-300 shadow-md absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none ring-2 ring-white/50"
                style={{
                  left: `${(hue / 360) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Controls Row: EXACT SAME HEIGHT (h-8 = 32px) FOR ALL ELEMENTS */}
          <div className="flex items-center gap-2 pt-0.5">
            {/* 1. Color Preview Swatch (Razor-sharp inset ring, NO blurry shadows) */}
            <div
              className="w-8 h-8 rounded-lg ring-1 ring-inset ring-black/10 flex-shrink-0"
              style={{ backgroundColor: value }}
              title={currentHexDisplay}
            />

            {/* 2. Eyedropper Button (h-8) */}
            {hasEyeDropper && (
              <button
                type="button"
                onClick={handlePickEyeDropper}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer flex-shrink-0"
                title="Sample color from screen"
              >
                <Pipette className="w-3.5 h-3.5 stroke-[1.75]" />
              </button>
            )}

            {/* 3. HEX Input Box (h-8 height) */}
            <div className="flex-1 h-8 flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2.5 focus-within:border-slate-400 focus-within:bg-white transition-colors">
              <span className="font-tomorrow text-xs text-slate-400 font-semibold mr-1.5 select-none">#</span>
              <input
                type="text"
                value={hexInput}
                maxLength={6}
                onChange={(e) => handleHexChange(e.target.value)}
                onBlur={handleHexBlur}
                className="w-full bg-transparent font-tomorrow text-xs font-semibold text-slate-800 uppercase focus:outline-none tracking-wider"
                placeholder="000000"
              />
            </div>
          </div>

          {/* Curated Swatches (Razor-sharp inset rings, NO blurry drop shadows) */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[10px] font-quicksand font-bold uppercase tracking-wider text-slate-400 mb-2">
              Classic Inks & Tones
            </div>
            <div className="grid grid-cols-6 gap-2">
              {PRESET_SWATCHES.map((swatch) => {
                const isSelected = currentHexDisplay === swatch.hex.toUpperCase();
                const isDark =
                  swatch.hex === '#000000' ||
                  swatch.hex === '#0F172A' ||
                  swatch.hex === '#1E3A8A' ||
                  swatch.hex === '#064E3B' ||
                  swatch.hex === '#78350F' ||
                  swatch.hex === '#881337';

                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => {
                      onStartEdit?.();
                      onChange(swatch.hex);
                      onFinishEdit?.();
                    }}
                    title={`${swatch.name} (${swatch.hex})`}
                    className={`group relative w-7 h-7 rounded-lg ring-1 ring-inset ring-black/10 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer ${
                      isSelected ? 'ring-2 ring-slate-900 ring-offset-2 scale-105' : ''
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && (
                      <Check
                        className={`w-3.5 h-3.5 stroke-[2.5] ${
                          isDark ? 'text-white' : 'text-slate-900'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
