'use client';

import { useEffect, useState } from 'react';
import { X, Sparkles, Loader2, Check } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import type { TextBox } from '../../types';

interface StarterTemplate {
  id: string;
  name: string;
  category: string;
  file: string;
  accent: string;
  seed: {
    name: Record<string, unknown>;
    course: Record<string, unknown>;
    date: Record<string, unknown>;
  };
  defaultFont: string;
}

const TEMPLATE_W = 2000;
const TEMPLATE_H = 1414;

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'formal', label: 'Formal' },
  { value: 'professional', label: 'Professional' },
  { value: 'academic', label: 'Academic' },
  { value: 'participation', label: 'Participation' },
  { value: 'tech', label: 'Tech' },
];

/**
 * Starter template gallery: professionally designed certificate backgrounds
 * the user can adopt in one click. The SVG artwork is rasterized to a PNG
 * client-side (same pipeline as an uploaded template), then the manifest's
 * field boxes (Name / Course / Date) are seeded onto the canvas.
 */
export function StarterGalleryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setTemplate, setBoxes, setEventName } = useAppStore();
  const { pushState } = useHistoryStore();
  const [templates, setTemplates] = useState<StarterTemplate[] | null>(null);
  const [category, setCategory] = useState('all');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || templates) return;
    fetch('/starter-templates/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: StarterTemplate[]) => setTemplates(data))
      .catch(() => setTemplates([]));
  }, [open, templates]);

  // Lock body scroll while open (same as other modals in the app).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const applyTemplate = async (t: StarterTemplate) => {
    setApplyingId(t.id);
    try {
      // Rasterize the SVG artwork to a PNG data URL at full template size.
      const img = new Image();
      img.decoding = 'sync';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG failed to load'));
        img.src = t.file;
      });
      const canvas = document.createElement('canvas');
      canvas.width = TEMPLATE_W;
      canvas.height = TEMPLATE_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(img, 0, 0, TEMPLATE_W, TEMPLATE_H);

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png')
      );
      const file = new File([blob], `${t.id}.png`, { type: 'image/png' });
      const display = new Image();
      const objectUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        display.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve();
        };
        display.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('redecode failed'));
        };
        display.src = objectUrl;
      });

      const makeBox = (seed: Record<string, unknown>, field: string, id: string): TextBox =>
        ({
          id,
          field,
          kind: 'field',
          ...seed,
        }) as unknown as TextBox;

      const { boxes: curBoxes, qrZones: curQrZones, images: curImages } = useAppStore.getState();
      pushState(curBoxes, curQrZones, curImages);
      setTemplate(file, display, `${t.name} — starter template`);
      setBoxes([
        makeBox(t.seed.name, 'Name', 'starter-name'),
        makeBox(t.seed.course, 'Course', 'starter-course'),
        makeBox(t.seed.date, 'Date', 'starter-date'),
      ]);
      setEventName(t.name);
      onClose();
    } catch (err) {
      console.warn('[StarterGallery] apply failed:', err);
    } finally {
      setApplyingId(null);
    }
  };

  const visible = (templates ?? []).filter((t) => category === 'all' || t.category === category);

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Starter template gallery"
    >
      <div
        className="bg-[#FBFAF5] rounded-2xl border border-stone-200 shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200/80">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary-600" />
            <div>
              <h2 className="font-semibold text-lg text-stone-900">Start from a template</h2>
              <p className="text-xs text-stone-500">
                Professionally designed layouts — pick one, then drag the text boxes to fit.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Close gallery"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-stone-200/60 flex gap-1.5 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors cursor-pointer ${
                category === c.value
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!templates && (
            <div className="flex items-center justify-center py-16 text-stone-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {templates && templates.length === 0 && (
            <p className="text-center text-sm text-stone-500 py-16">
              Gallery unavailable — check your connection and reopen.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void applyTemplate(t)}
                disabled={applyingId !== null}
                className="group text-left rounded-xl border border-stone-200/90 bg-white overflow-hidden hover:border-stone-400 hover:shadow-lg hover:shadow-stone-900/5 transition-all disabled:opacity-60 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <div className="aspect-[2000/1414] bg-stone-100">
                  <img
                    src={t.file}
                    alt={`${t.name} certificate template`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{t.name}</p>
                    <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: t.accent }}>
                      {t.category}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-stone-500 group-hover:text-primary-600 flex items-center gap-1">
                    {applyingId === t.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        Use
                      </>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
