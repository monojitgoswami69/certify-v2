'use client';

import { useState } from 'react';
import { X, Save, Check, AlertCircle, LayoutTemplate } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (templateId: string, templateName: string) => void;
}

export function SaveTemplateModal({ isOpen, onClose, onSaved }: SaveTemplateModalProps) {
  const { templateImage, templateFile, boxes, qrZones, defaultFont, defaultFontSize, defaultFontColor } = useAppStore();
  const { token } = useAuthStore();

  const [templateName, setTemplateName] = useState(
    templateFile?.name ? templateFile.name.replace(/\.[^/.]+$/, '') : 'Certificate Template'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateImage) {
      setError('No template image is loaded on the canvas');
      return;
    }

    if (!templateName.trim()) {
      setError('Please provide a name for this template');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Convert templateImage to Base64 data URL
      const canvas = document.createElement('canvas');
      canvas.width = templateImage.naturalWidth || templateImage.width;
      canvas.height = templateImage.naturalHeight || templateImage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not initialize canvas context');

      ctx.drawImage(templateImage, 0, 0);
      const imageData = canvas.toDataURL('image/png', 0.95);

      const payload = {
        name: templateName.trim(),
        imageData,
        width: canvas.width,
        height: canvas.height,
        layoutConfig: {
          boxes,
          qrZones,
          defaultFont,
          defaultFontSize,
          defaultFontColor,
        },
      };

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to save template');
      }

      const resData = await res.json();
      setSuccess(true);
      if (onSaved) {
        onSaved(resData.template.id, resData.template.name);
      }

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 border border-primary-200 flex items-center justify-center font-bold">
              <LayoutTemplate className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Save Reusable Template</h2>
              <p className="text-[11px] text-slate-400">Store layout &amp; graphic directly in database</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Template saved to database successfully!</span>
            </div>
          )}

          {/* Template Info Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Template Summary
            </div>
            <div className="grid grid-cols-3 gap-2 text-slate-700">
              <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400 block">Dimensions</span>
                <span className="font-mono font-semibold">
                  {templateImage ? `${templateImage.width}×${templateImage.height}` : '—'}
                </span>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400 block">Text Boxes</span>
                <span className="font-mono font-semibold">{boxes.length}</span>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400 block">QR Zones</span>
                <span className="font-mono font-semibold">{qrZones.length}</span>
              </div>
            </div>
          </div>

          {/* Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Template Name
            </label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Annual Tech Summit Merit Certificate"
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all font-medium"
              required
              autoFocus
            />
            <p className="text-[11px] text-slate-400">
              Saving saves the graphic and all drawn box positions, font styling, and QR codes.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || success}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : success ? 'Saved!' : 'Save to Database'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
