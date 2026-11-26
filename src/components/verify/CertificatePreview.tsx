'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { buildVerifyUrlFor } from '@/lib/verification-links';
import { ensureFontsLoaded } from '@/lib/font-loader';
import { downloadBlob, sanitizeFilename } from '@/lib/utils';
import type { ImageElement, QrZone, TextBox } from '@/types';

export interface CertificateAssetSpec {
  status: 'ok';
  certificateId: string;
  verificationOrigin?: string;
  recipientName: string;
  template: {
    imageUrl?: string;
    imageData?: string;
    width: number;
    height: number;
    previewWidth?: number;
    previewHeight?: number;
    isPreview?: boolean;
  } | null;
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

type AssetResponse = CertificateAssetSpec;

type DownloadFormat = 'pdf' | 'jpg' | 'png';

const PREVIEW_MAX_EDGE = 1400;

function decodeImageSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('template decode failed'));
    img.src = src;
  });
}

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
  prefetchedAsset,
  onAvailabilityChange,
}: {
  certificateId: string;
  recipientName: string;
  prefetchedAsset?: Promise<CertificateAssetSpec | null> | null;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [busyFormat, setBusyFormat] = useState<DownloadFormat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const templateImageRef = useRef<HTMLImageElement | null>(null);
  const fullTemplateImageRef = useRef<HTMLImageElement | null>(null);
  const isPreviewRef = useRef<boolean>(false);
  const layoutRef = useRef<AssetResponse['layoutConfig']>(null);
  const verificationOriginRef = useRef<string | null>(null);
  const fieldsRef = useRef<Record<string, string>>({});
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
    fullTemplateImageRef.current = null;
    isPreviewRef.current = false;

    (async () => {
      try {
        const asset = await (
          prefetchedAsset ??
          fetch(`/api/verify/${encodeURIComponent(certificateId)}/asset`).then((res) =>
            res.ok ? (res.json() as Promise<AssetResponse>) : null
          )
        );
        if (cancelled) return;
        const templateSrc = asset?.template?.imageUrl || asset?.template?.imageData;
        if (
          !asset ||
          asset.status !== 'ok' ||
          !templateSrc ||
          !asset.layoutConfig ||
          !Array.isArray(asset.layoutConfig.boxes) ||
          asset.layoutConfig.boxes.length === 0
        ) {
          setPhase('unavailable');
          onAvailabilityChange?.(false);
          return;
        }

        layoutRef.current = asset.layoutConfig;
        verificationOriginRef.current = asset.verificationOrigin ?? null;
        fieldsRef.current = asset.fields ?? {};
        isPreviewRef.current = Boolean(asset.template?.isPreview);

        const boxes = asset.layoutConfig.boxes ?? [];
        const fonts = new Set<string>(
          [...boxes.map((b) => b.fontFamily), asset.layoutConfig.defaultFont].filter(
            (f): f is string => Boolean(f)
          )
        );

        // Decode template image (served via CDN binary URL), load fonts, and load rendering code concurrently.
        const [img, , engine] = await Promise.all([
          decodeImageSrc(templateSrc),
          fonts.size > 0 ? ensureFontsLoaded(fonts) : Promise.resolve(),
          import('@/lib/certificate-engine'),
        ]);
        if (cancelled) return;
        templateImageRef.current = img;
        if (!asset.template?.isPreview) {
          fullTemplateImageRef.current = img;
        }

        // Render downscaled WebP preview directly in a single pass at longest-edge <= 1400px,
        // preserving full logical layout coordinates without allocating a 4K bitmap.
        const preview = await engine.renderCertificatePreviewBlob(
          {
            templateImage: img,
            logicalWidth: asset.template!.width,
            logicalHeight: asset.template!.height,
            boxes,
            row: fieldsRef.current,
            frozenFields: true,
            qrZones: asset.layoutConfig.qrZones?.length ? asset.layoutConfig.qrZones : undefined,
            images: asset.layoutConfig.images,
            verificationUrl: buildVerifyUrlFor(certificateId, verificationOriginRef.current),
          },
          PREVIEW_MAX_EDGE
        );
        if (cancelled) return;

        revokePreview();
        const url = URL.createObjectURL(preview.blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewWidth(preview.width);
        setPreviewHeight(preview.height);
        setPhase('ready');
      } catch (err) {
        console.warn('[CertificatePreview] unavailable:', err);
        if (!cancelled) {
          setPhase('unavailable');
          onAvailabilityChange?.(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      revokePreview();
    };
  }, [certificateId, prefetchedAsset, revokePreview, onAvailabilityChange]);

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
        const [{ generateCertificate }, fullTemplate] = await Promise.all([
          import('@/lib/certificate-engine'),
          (async () => {
            if (fullTemplateImageRef.current) return fullTemplateImageRef.current;
            if (!isPreviewRef.current && templateImageRef.current) {
              return templateImageRef.current;
            }
            const res = await fetch(`/api/verify/${encodeURIComponent(certificateId)}/asset?full=1`);
            if (!res.ok) throw new Error('Full-resolution asset fetch failed');
            const fullAsset = (await res.json()) as AssetResponse;
            const fullSrc = fullAsset.template?.imageUrl || fullAsset.template?.imageData;
            if (fullAsset.status !== 'ok' || !fullSrc) {
              throw new Error('Full-resolution template unavailable');
            }
            const decoded = await decodeImageSrc(fullSrc);
            fullTemplateImageRef.current = decoded;
            return decoded;
          })(),
        ]);
        const layout = layoutRef.current!;
        const rendered = await generateCertificate({
          templateImage: fullTemplate,
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
            ? rendered.pngBlob
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
        <div
          role="status"
          aria-busy="true"
          aria-label="Rendering certificate preview"
          className="w-full max-w-2xl lg:max-w-none flex flex-col items-center lg:items-stretch"
        >
          <div className="relative w-full aspect-[4/3] rounded-xl border border-stone-300/80 bg-stone-200/65 overflow-hidden cert-skeleton-shimmer p-6 sm:p-10 flex flex-col justify-between select-none">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 sm:w-12 sm:h-12" />
              <div className="h-3.5 w-28 sm:w-36 rounded bg-stone-300/80 mt-2" />
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-md bg-stone-300/75" />
            </div>

            <div className="flex flex-col items-center gap-3 my-auto py-4">
              <div className="h-5 sm:h-6 w-44 sm:w-56 rounded bg-stone-300/85" />
              <div className="h-2.5 w-24 sm:w-32 rounded bg-stone-300/65" />
              <div className="h-7 sm:h-8 w-56 sm:w-72 rounded bg-stone-300/90 mt-2" />
              <div className="h-2.5 w-4/5 max-w-md rounded bg-stone-300/65 mt-2" />
              <div className="h-2.5 w-3/5 max-w-sm rounded bg-stone-300/60" />
            </div>

            <div className="flex items-center justify-between gap-6 pt-2">
              <div className="h-2 flex-1 max-w-28 rounded bg-stone-300/70" />
              <div className="h-2 flex-1 max-w-28 rounded bg-stone-300/70" />
              <div className="h-2 flex-1 max-w-28 rounded bg-stone-300/70" />
            </div>
          </div>

          <div className="relative mt-4 h-[44px] w-full rounded-lg bg-stone-200/80 overflow-hidden cert-skeleton-shimmer" />
        </div>
      )}
      {phase === 'ready' && previewUrl && (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group relative block w-full max-w-2xl lg:max-w-none cursor-zoom-in focus:outline-none"
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
        <div ref={menuRef} className="relative mt-4 w-full max-w-2xl lg:max-w-none">
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
