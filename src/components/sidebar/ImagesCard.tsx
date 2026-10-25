'use client';

import { useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Sidebar card for decorative template images — logos, signatures, seals.
 * Images are placed on the canvas (drag/resize) and render on every
 * certificate, above the background and below text.
 */
export function ImagesCard() {
  const {
    templateImage,
    boxes,
    qrZones,
    images,
    activeImageId,
    addImage,
    updateImage,
    deleteImage,
    setActiveImage,
  } = useAppStore();
  const { pushState } = useHistoryStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!templateImage) return null;

  const templateW = templateImage.naturalWidth || templateImage.width;
  const templateH = templateImage.naturalHeight || templateImage.height;

  const handleFile = async (file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Use a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image is too large (max 1.5 MB).');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    // Fit within 40% of the template, preserving aspect ratio.
    const decoded = new Image();
    await new Promise<void>((resolve, reject) => {
      decoded.onload = () => resolve();
      decoded.onerror = () => reject(new Error('decode failed'));
      decoded.src = dataUrl;
    });
    const maxW = templateW * 0.4;
    const scale = Math.min(1, maxW / (decoded.naturalWidth || 1));
    const w = Math.round((decoded.naturalWidth || 200) * scale);
    const h = Math.round((decoded.naturalHeight || 120) * scale);

    pushState(boxes, qrZones, images);
    addImage({
      x: Math.round(templateW * 0.08),
      y: Math.round(templateH * 0.08),
      w,
      h,
      src: dataUrl,
      opacity: 1,
    });
  };

  const activeImage = images.find((el) => el.id === activeImageId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Logos &amp; Signatures
        </p>
        <span className="text-[10px] font-mono text-stone-400">{images.length}</span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-stone-700 border border-dashed border-stone-300 rounded-lg hover:border-stone-500 hover:bg-stone-50 transition-colors cursor-pointer"
      >
        <ImageIcon className="w-3.5 h-3.5" />
        Add Logo / Signature Image
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {images.length > 0 && (
        <div className="space-y-1.5">
          {images.map((el, index) => (
            <button
              key={el.id}
              type="button"
              onClick={() => setActiveImage(el.id === activeImageId ? null : el.id)}
              className={`w-full flex items-center justify-between py-2 px-3 rounded-lg border text-left transition-colors ${
                el.id === activeImageId
                  ? 'border-primary-400 bg-primary-50'
                  : 'border-stone-200/80 hover:border-stone-400 hover:bg-stone-50'
              }`}
            >
              <span className="text-xs font-medium text-stone-800">
                Image {index + 1}
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                {Math.round(el.w)} × {Math.round(el.h)} px
              </span>
            </button>
          ))}
        </div>
      )}

      {activeImage && (
        <div className="p-3 rounded-lg border border-stone-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">Selected image</p>
            <button
              type="button"
              onClick={() => {
                pushState(boxes, qrZones, images);
                deleteImage(activeImage.id);
              }}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="Delete image"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Opacity — {Math.round((activeImage.opacity ?? 1) * 100)}%
            </label>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round((activeImage.opacity ?? 1) * 100)}
              onChange={(e) => updateImage(activeImage.id, { opacity: Number(e.target.value) / 100 })}
              className="w-full accent-primary-600 cursor-pointer"
            />
          </div>
          <p className="text-[11px] text-stone-400">
            Drag on the canvas to move; drag a corner handle to resize.
          </p>
        </div>
      )}
    </div>
  );
}
