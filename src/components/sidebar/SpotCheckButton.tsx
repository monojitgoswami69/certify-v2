'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, Eye } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { buildVerifyUrlFor } from '../../lib/cert-registration';
import { ensureFontsLoaded } from '../../lib/font-loader';
import type { TextBox, QrZone } from '../../types';

const PREVIEW_CACHE_LIMIT = 40;

/**
 * Spot-check mode: flip through fully rendered certificates, one recipient at
 * a time, before generating or sending — catch typos and layout mistakes on
 * real data instead of discovering them in an inbox.
 */
export function SpotCheckButton({ disabled }: { disabled?: boolean }) {
  const { templateImage, csvData, boxes, qrZones, eventName, registeredCertIds, isBatchRegistered, registrationDirty } =
    useAppStore();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSeqRef = useRef(0);

  const useQr = qrZones.length > 0;
  const validBoxes = boxes.filter((b) => b.field || b.kind === 'static');
  const canOpen = Boolean(templateImage && csvData.length > 0 && validBoxes.length > 0);
  const qrBlocked = useQr && (!isBatchRegistered || registrationDirty);

  useEffect(() => {
    if (!open) {
      cacheRef.current.clear();
      setIndex(0);
      setDataUrl(null);
    }
  }, [open]);

  // Escape closes (matching the app's other modals).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, csvData.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, csvData.length]);

  useEffect(() => {
    if (!open || !templateImage) return;
    const rowIndex = index + 2;
    const row = csvData[index];
    const seq = ++renderSeqRef.current;

    (async () => {
      const cached = cacheRef.current.get(rowIndex);
      if (cached) {
        setDataUrl(cached);
        return;
      }
      setRendering(true);
      try {
        const boxes_ = validBoxes as TextBox[];
        const fonts = new Set(
          [...boxes_.map((b) => b.fontFamily)].filter((f): f is string => Boolean(f))
        );
        if (fonts.size > 0) await ensureFontsLoaded(fonts);

        const { generateCertificate } = await import('../../lib/certificate-engine');
        if (seq !== renderSeqRef.current) return;

        const certId = registeredCertIds.get(rowIndex);
        const cert = await generateCertificate({
          templateImage,
          boxes: boxes_,
          row,
          filename: 'spot-check',
          includePng: true,
          includeBase64: true,
          qrZones: useQr ? (qrZones as QrZone[]) : undefined,
          images: undefined,
          verificationUrl: useQr && certId ? buildVerifyUrlFor(certId) : undefined,
          canvas: canvasRef.current ?? undefined,
        });
        if (seq !== renderSeqRef.current || !cert.pngBase64) return;

        if (cacheRef.current.size >= PREVIEW_CACHE_LIMIT) {
          const oldest = cacheRef.current.keys().next().value;
          if (oldest !== undefined) cacheRef.current.delete(oldest);
        }
        cacheRef.current.set(rowIndex, cert.pngBase64);
        setDataUrl(cert.pngBase64);
      } catch (err) {
        console.warn('[SpotCheck] render failed:', err);
        setDataUrl(null);
      } finally {
        if (seq === renderSeqRef.current) setRendering(false);
      }
    })();
  }, [open, index, templateImage, csvData, validBoxes, qrZones, useQr, registeredCertIds]);

  if (!canOpen) return null;

  const recipient = csvData[index];
  const displayName =
    validBoxes.find((b) => b.kind !== 'static' && b.field.toLowerCase().includes('name'))?.field &&
    recipient[validBoxes.find((b) => b.field.toLowerCase().includes('name'))!.field]
      ? recipient[validBoxes.find((b) => b.field.toLowerCase().includes('name'))!.field]
      : `Recipient ${index + 1}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || qrBlocked}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="Flip through rendered certificates before generating or sending"
      >
        <Eye className="w-3.5 h-3.5 text-primary-600" />
        Spot-check certificates
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Spot-check certificates"
        >
          <div
            className="bg-[#FBFAF5] rounded-2xl border border-stone-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200/80">
              <div>
                <h2 className="font-jura font-bold text-base text-stone-900">
                  Spot check — {eventName || 'Untitled event'}
                </h2>
                <p className="text-xs text-stone-500 font-quicksand">
                  {displayName} · {index + 1} of {csvData.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                aria-label="Close spot check"
              >
                <X className="w-5 h-5 text-stone-500" />
              </button>
            </div>

            <div className="relative flex-1 overflow-auto bg-stone-100 flex items-center justify-center p-4 min-h-[40vh]">
              {rendering && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-stone-100/70">
                  <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                </div>
              )}
              {dataUrl ? (
                <img
                  src={dataUrl}
                  alt={`Certificate preview for ${displayName}`}
                  className="max-w-full max-h-[60vh] w-auto h-auto rounded-lg shadow-lg"
                />
              ) : (
                <div className="text-sm text-stone-400 py-16">Preview unavailable</div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex items-center justify-center gap-3 px-5 py-3 border-t border-stone-200/80">
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                disabled={index === 0}
                className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-40 transition-colors cursor-pointer"
                aria-label="Previous recipient"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, csvData.length - 1)}
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
                className="w-64 accent-primary-600 cursor-pointer"
                aria-label="Recipient selector"
              />
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(i + 1, csvData.length - 1))}
                disabled={index >= csvData.length - 1}
                className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-40 transition-colors cursor-pointer"
                aria-label="Next recipient"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
