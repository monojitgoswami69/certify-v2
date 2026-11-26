'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { buildVerifyUrlFor } from '@/lib/verification-links';
import { ensureFontsLoaded } from '@/lib/font-loader';
import { downloadBlob, sanitizeFilename } from '@/lib/utils';
import type { ImageElement, QrZone, TextBox } from '@/types';

interface AssetResponse {
  status: 'ok';
  certificateId: string;
  verificationOrigin?: string;
  recipientName: string;
  template: { imageData: string; width: number; height: number } | null;
  layoutConfig: {
    boxes?: TextBox[];
    qrZones?: QrZone[];
    images?: ImageElement[];
    defaultFont?: string;
    defaultFontSize?: number;
    defaultFontColor?: string;
  } | null;
  fields: Record<string, string>;
}

type DownloadFormat = 'pdf' | 'jpg' | 'png';

const PREVIEW_MAX_WIDTH = 720;

/**
 * The verifier-facing certificate sheet: renders the certificate face from the
 * public asset endpoint and offers full-quality PDF/JPG/PNG downloads using
 * the same engine the issuer's batch pipeline uses. Renders nothing (returns
 * null) when no template is available or anything fails — the verification
 * record beside it is never blocked by preview problems.
 */
export function CertificatePreview({
  certificateId,
  recipientName,
}: {
  certificateId: string;
  recipientName: string;
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [busyFormat, setBusyFormat] = useState<DownloadFormat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const templateImageRef = useRef<HTMLImageElement | null>(null);
  const layoutRef = useRef<AssetResponse['layoutConfig']>(null);
  const verificationOriginRef = useRef<string | null>(null);
  const fieldsRef = useRef<Record<string, string>>({});
  const fullPngRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const baseName = sanitizeFilename(recipientName) + '-certificate';

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Load the render spec and produce the on-screen preview.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(certificateId)}/asset`);
        if (!res.ok) throw new Error(`asset ${res.status}`);
        const asset = (await res.json()) as AssetResponse;
        if (cancelled) return;
        if (
          asset.status !== 'ok' ||
          !asset.template?.imageData ||
          !asset.layoutConfig ||
          !Array.isArray(asset.layoutConfig.boxes) ||
          asset.layoutConfig.boxes.length === 0
        ) {
          setPhase('unavailable');
          return;
        }

        layoutRef.current = asset.layoutConfig;
        verificationOriginRef.current = asset.verificationOrigin ?? null;
        fieldsRef.current = asset.fields ?? {};

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('template decode failed'));
          img.src = asset.template!.imageData;
        });
        if (cancelled) return;
        templateImageRef.current = img;

        const boxes = asset.layoutConfig.boxes ?? [];
        const fonts = new Set<string>(
          [...boxes.map((b) => b.fontFamily), asset.layoutConfig.defaultFont].filter(
            (f): f is string => Boolean(f)
          )
        );
        if (fonts.size > 0) await ensureFontsLoaded(fonts);
        if (cancelled) return;

        // Dynamic import: the engine (and its jsPDF/qrcode deps) only loads
        // on pages that actually show a certificate.
        const { generateCertificate } = await import('@/lib/certificate-engine');
        if (cancelled) return;

        const rendered = await generateCertificate({
          templateImage: img,
          boxes,
          row: fieldsRef.current,
          frozenFields: true,
          filename: baseName,
          includePng: true,
          qrZones: asset.layoutConfig.qrZones?.length
            ? asset.layoutConfig.qrZones
            : undefined,
          images: asset.layoutConfig.images,
          verificationUrl: buildVerifyUrlFor(certificateId, verificationOriginRef.current),
        });
        if (cancelled || !rendered.pngBlob) throw new Error('preview render failed');
        fullPngRef.current = rendered.pngBlob;

        // Downscaled copy for display; full-res stays cached for downloads.
        const scale = Math.min(1, PREVIEW_MAX_WIDTH / img.naturalWidth);
        let previewBlob: Blob = rendered.pngBlob;
        try {
          const bitmap = await createImageBitmap(rendered.pngBlob);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          previewBlob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('preview encode failed'))),
              'image/png'
            )
          );
        } catch {
          // Full-resolution fallback: heavier, but always works.
        }
        if (cancelled) return;

        revokePreview();
        const url = URL.createObjectURL(previewBlob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewWidth(Math.round(img.naturalWidth * scale));
        setPreviewHeight(Math.round(img.naturalHeight * scale));
        setPhase('ready');
      } catch (err) {
        console.warn('[CertificatePreview] unavailable:', err);
        if (!cancelled) setPhase('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      revokePreview();
    };
  }, [certificateId, baseName, revokePreview]);

  // Close the download menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  const handleDownload = useCallback(
    async (format: DownloadFormat) => {
      if (busyFormat || phase !== 'ready') return;
      setMenuOpen(false);
      setBusyFormat(format);
      try {
        const { generateCertificate } = await import('@/lib/certificate-engine');
        const layout = layoutRef.current!;
        const rendered = await generateCertificate({
          templateImage: templateImageRef.current!,
          boxes: layout.boxes ?? [],
          row: fieldsRef.current,
          frozenFields: true,
          filename: baseName,
          includePng: format === 'png',
          includeJpg: format === 'jpg',
          includePdf: format === 'pdf',
          qrZones: layout.qrZones?.length ? layout.qrZones : undefined,
          images: layout.images,
          verificationUrl: buildVerifyUrlFor(certificateId, verificationOriginRef.current),
        });
        const blob =
          format === 'png'
            ? rendered.pngBlob ?? fullPngRef.current
            : format === 'jpg'
              ? rendered.jpgBlob
              : rendered.pdfBlob;
        if (!blob) throw new Error(`${format} render failed`);
        downloadBlob(blob, `${baseName}.${format}`);
      } catch (err) {
        console.warn('[CertificatePreview] download failed:', err);
      } finally {
        setBusyFormat(null);
      }
    },
    [busyFormat, phase, baseName, certificateId]
  );

  if (phase === 'unavailable') return null;

  return (
    <div className="w-full flex flex-col items-center lg:items-stretch">
      {/* Certificate sheet */}
      {phase === 'loading' && (
        <div className="w-full max-w-md lg:max-w-none aspect-[4/3] rounded-xl border border-stone-200/80 bg-white/60 animate-pulse" />
      )}
      {phase === 'ready' && previewUrl && (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group relative block w-full max-w-md lg:max-w-none cursor-zoom-in focus:outline-none"
          title="Click to enlarge"
        >
          <img
            src={previewUrl}
            alt={`Certificate preview for ${recipientName}`}
            width={previewWidth ?? undefined}
            height={previewHeight ?? undefined}
            className="w-full h-auto rounded-xl border border-stone-200/90 bg-white shadow-md shadow-stone-900/5 transition-shadow group-hover:shadow-lg group-hover:shadow-stone-900/10"
          />
        </button>
      )}

      {/* Download dropdown */}
      {phase === 'ready' && (
        <div ref={menuRef} className="relative mt-4 w-full max-w-md lg:max-w-none">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={Boolean(busyFormat)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {busyFormat ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Preparing {busyFormat.toUpperCase()}…</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download Certificate</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>

          {menuOpen && (
            <div className="absolute z-20 mt-2 w-full rounded-lg border border-stone-200 bg-white shadow-lg shadow-stone-900/10 overflow-hidden">
              {(
                [
                  { format: 'pdf' as const, label: 'Download as PDF', Icon: FileText },
                  { format: 'jpg' as const, label: 'Download as JPG', Icon: ImageIcon },
                  { format: 'png' as const, label: 'Download as PNG', Icon: ImageIcon },
                ]
              ).map(({ format, label, Icon }) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => handleDownload(format)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  <Icon className="w-4 h-4 text-stone-400" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Full-size lightbox */}
      {lightboxOpen && previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8 animate-fade-in cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Certificate full preview"
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={previewUrl}
            alt={`Certificate for ${recipientName}`}
            className="max-w-full max-h-full w-auto h-auto rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
