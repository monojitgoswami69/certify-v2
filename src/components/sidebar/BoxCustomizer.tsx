'use client';

import { useState } from 'react';
import { Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { FontSelector } from './FontSelector';
import { CustomSelect } from '../ui/CustomSelect';
import type { HorizontalAlign, VerticalAlign } from '../../types';

export function BoxCustomizer() {
  const {
    boxes,
    activeBoxId,
    csvHeaders,
    csvData,
    qrZones,
    updateBox,
    deleteBox,
    setFontPreview,
  } = useAppStore();

  const { pushState } = useHistoryStore();

  const activeBox = boxes.find((b) => b.id === activeBoxId);

  const [fontSizeInput, setFontSizeInput] = useState<string>(
    activeBox ? String(activeBox.fontSize) : '60'
  );

  if (
    activeBox &&
    String(activeBox.fontSize) !== fontSizeInput &&
    typeof document !== 'undefined' &&
    document.activeElement?.tagName !== 'INPUT'
  ) {
    setFontSizeInput(String(activeBox.fontSize));
  }

  if (!activeBox) {
    if (boxes.length === 0) {
      return (
        <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center">
          <p className="text-sm text-slate-500">
            Draw a box on the template to add text areas
          </p>
        </div>
      );
    }
    return (
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
        <p className="text-sm text-slate-500">Click on a box to customize it</p>
      </div>
    );
  }

  const previewValue =
    csvData.length > 0 && activeBox.field ? csvData[0][activeBox.field] || '(empty)' : '';

  const handleUpdate = (updates: Partial<typeof activeBox>) => {
    pushState(boxes, qrZones);
    updateBox(activeBox.id, updates);
  };

  const handleFontSizeChange = (value: string) => {
    setFontSizeInput(value);
    const num = parseInt(value);
    if (!isNaN(num) && num >= 10 && num <= 200) {
      handleUpdate({ fontSize: num });
    }
  };

  const handleFontSizeBlur = () => {
    const num = parseInt(fontSizeInput);
    if (isNaN(num) || num < 10) {
      setFontSizeInput('10');
      handleUpdate({ fontSize: 10 });
    } else if (num > 200) {
      setFontSizeInput('200');
      handleUpdate({ fontSize: 200 });
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
          <p className="text-xs text-slate-400 uppercase tracking-wide">Selected Box</p>
          <p className="font-medium text-slate-700 mt-0.5">
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
          <p className="text-xs text-primary-600 mb-0.5">First row preview:</p>
          <p className="text-sm font-medium text-primary-800 truncate">{previewValue}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">CSV Field</label>
        <CustomSelect
          value={activeBox.field}
          onChange={(val) => handleUpdate({ field: val })}
          options={[
            { value: '', label: 'Select a field...' },
            ...csvHeaders.map((h) => ({ value: h, label: h })),
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
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Size (px)</label>
          <input
            type="number"
            min={10}
            max={200}
            value={fontSizeInput}
            onChange={(e) => handleFontSizeChange(e.target.value)}
            onBlur={handleFontSizeBlur}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Color</label>
          <input
            type="color"
            value={activeBox.fontColor}
            onChange={(e) => handleUpdate({ fontColor: e.target.value })}
            className="w-full h-10 border border-slate-200 rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-500">Alignment</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-400 mb-1">Horizontal</p>
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
            <p className="text-xs text-slate-400 mb-1">Vertical</p>
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

      <div className="p-2 bg-slate-50 rounded-lg">
        <p className="text-xs text-slate-400 mb-1">Position & Bounds</p>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div>
            <span className="text-slate-400">X:</span>{' '}
            <span className="font-mono text-slate-600">{Math.round(activeBox.x)}</span>
          </div>
          <div>
            <span className="text-slate-400">Y:</span>{' '}
            <span className="font-mono text-slate-600">{Math.round(activeBox.y)}</span>
          </div>
          <div>
            <span className="text-slate-400">W:</span>{' '}
            <span className="font-mono text-slate-600">{Math.round(activeBox.w)}</span>
          </div>
          <div>
            <span className="text-slate-400">H:</span>{' '}
            <span className="font-mono text-slate-600">{Math.round(activeBox.h)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
