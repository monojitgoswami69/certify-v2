'use client';

import { useState, useRef, useEffect } from 'react';
import { Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { FontSelector } from './FontSelector';
import { ColorPicker } from './ColorPicker';
import { CustomSelect } from '../ui/CustomSelect';
import { resolveFieldValue } from '../../lib/utils';
import type { HorizontalAlign, VerticalAlign } from '../../types';

import { QrCustomizer } from './QrCustomizer';

export function BoxCustomizer() {
  const {
    boxes,
    activeBoxId,
    activeQrId,
    csvHeaders,
    csvData,
    qrZones,
    updateBox,
    deleteBox,
    setFontPreview,
    setActiveBox,
    setActiveQrId,
  } = useAppStore();

  const { pushState } = useHistoryStore();

  const activeBox = boxes.find((b) => b.id === activeBoxId);
  const activeQr = qrZones.find((z) => z.id === activeQrId);

  const focusedInputRef = useRef<string | null>(null);
  const isInputEditingRef = useRef(false);

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

  const [fontSizeInput, setFontSizeInput] = useState<string>(
    activeBox ? String(activeBox.fontSize) : '60'
  );
  const [xInput, setXInput] = useState<string>(
    activeBox ? String(Math.round(activeBox.x)) : '0'
  );
  const [yInput, setYInput] = useState<string>(
    activeBox ? String(Math.round(activeBox.y)) : '0'
  );
  const [wInput, setWInput] = useState<string>(
    activeBox ? String(Math.round(activeBox.w)) : '100'
  );
  const [hInput, setHInput] = useState<string>(
    activeBox ? String(Math.round(activeBox.h)) : '50'
  );

  useEffect(() => {
    if (!activeBox) return;
    if (focusedInputRef.current !== 'fontSize') {
      setFontSizeInput(String(activeBox.fontSize));
    }
    if (focusedInputRef.current !== 'x') {
      setXInput(String(Math.round(activeBox.x)));
    }
    if (focusedInputRef.current !== 'y') {
      setYInput(String(Math.round(activeBox.y)));
    }
    if (focusedInputRef.current !== 'w') {
      setWInput(String(Math.round(activeBox.w)));
    }
    if (focusedInputRef.current !== 'h') {
      setHInput(String(Math.round(activeBox.h)));
    }
  }, [activeBox?.fontSize, activeBox?.x, activeBox?.y, activeBox?.w, activeBox?.h, activeBox?.id]);

  // If a QR code is selected, render the rich QR customizer
  if (activeQr) {
    return <QrCustomizer activeQr={activeQr} />;
  }

  // If no text box is selected
  if (!activeBox) {
    if (boxes.length === 0 && qrZones.length === 0) {
      return (
        <div className="py-8 text-center text-stone-500 space-y-1.5">
          <p className="text-sm font-medium text-stone-700">No elements created yet</p>
          <p className="text-xs text-stone-500">
            Draw a box on the template in Step 3 to add dynamic text or click &apos;Add QR Code&apos;
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-4 py-2">
        <p className="text-xs text-stone-500">
          Click an element on the canvas to customize it, or select below:
        </p>
        <div className="space-y-1.5">
          {boxes.map((box, index) => (
            <button
              key={box.id}
              type="button"
              onClick={() => setActiveBox(box.id)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-stone-200/80 hover:border-stone-400 hover:bg-stone-50 text-left transition-colors"
            >
              <span className="text-xs font-medium text-stone-800">
                {box.field || `Text Box ${index + 1}`}
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                {Math.round(box.w)} × {Math.round(box.h)} px
              </span>
            </button>
          ))}
          {qrZones.map((zone, index) => (
            <button
              key={zone.id}
              type="button"
              onClick={() => setActiveQrId(zone.id)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-stone-200/80 hover:border-stone-400 hover:bg-stone-50 text-left transition-colors"
            >
              <span className="text-xs font-medium text-stone-800">
                {qrZones.length > 1 ? `QR Code ${index + 1}` : 'QR Verification Code'}
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                {Math.round(zone.size)} × {Math.round(zone.size)} px
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const previewValue =
    csvData.length > 0 && activeBox.field ? resolveFieldValue(activeBox.field, csvData[0]) || '(empty)' : '';

  const handleUpdate = (updates: Partial<typeof activeBox>) => {
    pushState(boxes, qrZones);
    updateBox(activeBox.id, updates);
  };

  const handleFontSizeChange = (value: string) => {
    setFontSizeInput(value);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 10 && num <= 200) {
      startInputEdit();
      updateBox(activeBox.id, { fontSize: num });
    }
  };

  const handleFontSizeBlur = () => {
    finishInputEdit();
    const num = parseInt(fontSizeInput);
    if (isNaN(num) || num < 10) {
      setFontSizeInput('10');
      updateBox(activeBox.id, { fontSize: 10 });
    } else if (num > 200) {
      setFontSizeInput('200');
      updateBox(activeBox.id, { fontSize: 200 });
    }
  };

  const handleXChange = (value: string) => {
    setXInput(value);
    const num = parseInt(value);
    if (!isNaN(num)) {
      startInputEdit();
      updateBox(activeBox.id, { x: num });
    }
  };

  const handleXBlur = () => {
    finishInputEdit();
    const num = parseInt(xInput);
    if (isNaN(num)) {
      const fallback = Math.round(activeBox.x);
      setXInput(String(fallback));
      updateBox(activeBox.id, { x: fallback });
    } else {
      setXInput(String(num));
      updateBox(activeBox.id, { x: num });
    }
  };

  const handleYChange = (value: string) => {
    setYInput(value);
    const num = parseInt(value);
    if (!isNaN(num)) {
      startInputEdit();
      updateBox(activeBox.id, { y: num });
    }
  };

  const handleYBlur = () => {
    finishInputEdit();
    const num = parseInt(yInput);
    if (isNaN(num)) {
      const fallback = Math.round(activeBox.y);
      setYInput(String(fallback));
      updateBox(activeBox.id, { y: fallback });
    } else {
      setYInput(String(num));
      updateBox(activeBox.id, { y: num });
    }
  };

  const handleWChange = (value: string) => {
    setWInput(value);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 10) {
      startInputEdit();
      updateBox(activeBox.id, { w: num });
    }
  };

  const handleWBlur = () => {
    finishInputEdit();
    const num = parseInt(wInput);
    if (isNaN(num) || num < 10) {
      const fallback = Math.max(10, Math.round(activeBox.w));
      setWInput(String(fallback));
      updateBox(activeBox.id, { w: fallback });
    } else {
      setWInput(String(num));
      updateBox(activeBox.id, { w: num });
    }
  };

  const handleHChange = (value: string) => {
    setHInput(value);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 10) {
      startInputEdit();
      updateBox(activeBox.id, { h: num });
    }
  };

  const handleHBlur = () => {
    finishInputEdit();
    const num = parseInt(hInput);
    if (isNaN(num) || num < 10) {
      const fallback = Math.max(10, Math.round(activeBox.h));
      setHInput(String(fallback));
      updateBox(activeBox.id, { h: fallback });
    } else {
      setHInput(String(num));
      updateBox(activeBox.id, { h: num });
    }
  };

  const hAlignOptions: { value: HorizontalAlign; icon: typeof AlignLeft; label: string }[] = [
    { value: 'left', icon: AlignLeft, label: 'Left' },
    { value: 'center', icon: AlignCenter, label: 'Center' },
    { value: 'right', icon: AlignRight, label: 'Right' },
  ];

  const vAlignOptions: { value: VerticalAlign; label: string }[] = [
    { value: 'top', label: 'Top' },
    { value: 'middle', label: 'Middle' },
    { value: 'bottom', label: 'Bottom' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Selected Box</p>
          <p className="font-semibold text-slate-800 mt-0.5">
            {activeBox.field || 'No field selected'}
          </p>
        </div>
        <button
          onClick={() => {
            pushState(boxes, qrZones);
            deleteBox(activeBox.id);
          }}
          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Delete Box"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {previewValue && (
        <div className="p-2 bg-primary-50 rounded-lg border border-primary-100">
          <p className="text-xs font-semibold text-primary-700 mb-0.5">First row preview:</p>
          <p className="text-sm font-medium text-primary-800 truncate">{previewValue}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">CSV Field</label>
        <CustomSelect
          value={activeBox.field}
          onChange={(val) => handleUpdate({ field: val })}
          options={[
            { value: '', label: 'Select a field...' },
            ...Array.from(
              new Set([...csvHeaders, ...(activeBox.field ? [activeBox.field] : [])])
            ).map((h) => ({ value: h, label: h })),
          ]}
          placeholder="Select a field..."
          searchable
        />
      </div>

      <div>
        <FontSelector
          value={activeBox.fontFamily}
          onChange={(fontFamily) => handleUpdate({ fontFamily })}
          onPreview={(fontFamily) => {
            if (fontFamily) {
              setFontPreview({ boxId: activeBox.id, fontFamily });
            } else {
              setFontPreview(null);
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Size (px)</label>
          <input
            type="number"
            min={10}
            max={200}
            value={fontSizeInput}
            onFocus={() => {
              focusedInputRef.current = 'fontSize';
            }}
            onChange={(e) => handleFontSizeChange(e.target.value)}
            onBlur={handleFontSizeBlur}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Color</label>
          <ColorPicker
            value={activeBox.fontColor}
            onStartEdit={startInputEdit}
            onChange={(hex) => {
              updateBox(activeBox.id, { fontColor: hex });
            }}
            onFinishEdit={finishInputEdit}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-600">Alignment</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Horizontal</p>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {hAlignOptions.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => handleUpdate({ hAlign: value })}
                  className={`flex-1 p-1.5 rounded-md transition-all ${
                    activeBox.hAlign === value
                      ? 'bg-white text-primary-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title={label}
                >
                  <Icon className="w-4 h-4 mx-auto" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Vertical</p>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {vAlignOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleUpdate({ vAlign: value })}
                  className={`flex-1 px-2 py-1.5 rounded-md transition-all text-xs font-medium ${
                    activeBox.vAlign === value
                      ? 'bg-white text-primary-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  title={label}
                >
                  {label.charAt(0)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Position & Bounds */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800">Position & Bounds</label>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">px</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* X */}
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-xs font-bold text-slate-400 select-none pointer-events-none">
              X
            </span>
            <input
              type="number"
              value={xInput}
              onChange={(e) => handleXChange(e.target.value)}
              onFocus={() => {
                focusedInputRef.current = 'x';
              }}
              onBlur={handleXBlur}
              className="w-full pl-7 pr-2 py-1.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 hover:border-slate-300 transition-colors"
              title="X position (px)"
            />
          </div>

          {/* Y */}
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-xs font-bold text-slate-400 select-none pointer-events-none">
              Y
            </span>
            <input
              type="number"
              value={yInput}
              onChange={(e) => handleYChange(e.target.value)}
              onFocus={() => {
                focusedInputRef.current = 'y';
              }}
              onBlur={handleYBlur}
              className="w-full pl-7 pr-2 py-1.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 hover:border-slate-300 transition-colors"
              title="Y position (px)"
            />
          </div>

          {/* W */}
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-xs font-bold text-slate-400 select-none pointer-events-none">
              W
            </span>
            <input
              type="number"
              min={10}
              value={wInput}
              onChange={(e) => handleWChange(e.target.value)}
              onFocus={() => {
                focusedInputRef.current = 'w';
              }}
              onBlur={handleWBlur}
              className="w-full pl-7 pr-2 py-1.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 hover:border-slate-300 transition-colors"
              title="Width (px)"
            />
          </div>

          {/* H */}
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-xs font-bold text-slate-400 select-none pointer-events-none">
              H
            </span>
            <input
              type="number"
              min={10}
              value={hInput}
              onChange={(e) => handleHChange(e.target.value)}
              onFocus={() => {
                focusedInputRef.current = 'h';
              }}
              onBlur={handleHBlur}
              className="w-full pl-7 pr-2 py-1.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 hover:border-slate-300 transition-colors"
              title="Height (px)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
