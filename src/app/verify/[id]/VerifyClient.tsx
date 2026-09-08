'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { ConfettiCanvas } from '@/components/verify/ConfettiCanvas';

type VerifyResponse =
  | {
      status: 'valid';
      recipientName: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt: string;
      issuedBy?: string | null;
    }
  | {
      status: 'revoked';
      recipientName?: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt?: string;
      issuedBy?: string | null;
    }
  | { status: 'not_found' }
  | { status: 'rate_limited'; detail?: string }
  | { status: 'error'; detail?: string };

export function VerifyClient({
  id,
}: {
  id: string;
  defaultIssuedBy?: string;
}) {
  const [state, setState] = useState<'loading' | VerifyResponse>('loading');
  const [confettiComplete, setConfettiComplete] = useState(false);

  const fetchVerification = () => {
    setState('loading');
    setConfettiComplete(false);
    let cancelled = false;

    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('certify_auth_token') ||
          sessionStorage.getItem('certify_session_token') ||
          localStorage.getItem('credify_auth_token') ||
          sessionStorage.getItem('credify_session_token')
        : null;

    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(`/api/verify/${encodeURIComponent(id)}`, { headers })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({ status: 'error' }))) as VerifyResponse;
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cancel = fetchVerification();
    return () => {
      if (cancel) cancel();
    };
  }, [id]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  // -------------------------------------------------------------
  // STATE 1: LOADING / VERIFYING INDICATOR (Authentic Magnifier Search)
  // -------------------------------------------------------------
  if (state === 'loading') {
    return (
      <div className="w-full flex flex-col items-center justify-center py-14 sm:py-20 text-center animate-fade-in">
        {/* Animated Authentic Magnifying Glass Search Graphic */}
        <div className="relative flex items-center justify-center w-32 h-32 mb-7 select-none">
          {/* Concentric Registry Ping Rings */}
          <div className="absolute inset-1 rounded-full bg-emerald-500/10 verify-ping-1 pointer-events-none" />
          <div className="absolute inset-1 rounded-full bg-emerald-500/10 verify-ping-2 pointer-events-none" />

          {/* Underneath: Certificate Credential Sheet being scanned */}
          <div className="absolute w-17 h-22 rounded-xl bg-white/95 border border-stone-200/90 shadow-2xs flex flex-col p-2.5 gap-1.5 pointer-events-none opacity-90 backdrop-blur-xs">
            {/* Header pill / logo dot */}
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <div className="w-6 h-1 bg-stone-300 rounded-full" />
            </div>
            {/* Body content lines */}
            <div className="w-full h-1 bg-stone-200/90 rounded-full mt-1" />
            <div className="w-10 h-1 bg-stone-200/90 rounded-full" />
            <div className="w-11 h-1 bg-stone-200/90 rounded-full" />
            {/* Mini seal */}
            <div className="mt-auto self-end w-4 h-4 rounded-full bg-emerald-50 border border-emerald-300/80 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            </div>
          </div>

          {/* Foreground: Magnifying Glass actively scanning and verifying */}
          <div className="relative z-10 verify-magnifier-track pointer-events-none drop-shadow-sm">
            <svg className="w-20 h-20" viewBox="0 0 76 76" fill="none">
              <defs>
                <linearGradient id="magnifierLens" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#34D399" stopOpacity="0.25" />
                  <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0.2" />
                </linearGradient>
                <clipPath id="lensClip">
                  <circle cx="32" cy="32" r="17.5" />
                </clipPath>
              </defs>

              {/* Lens Outer Polished Rim */}
              <circle
                cx="32"
                cy="32"
                r="19"
                stroke="#0F172A"
                strokeWidth="3.5"
                className="fill-white/85"
              />

              {/* Refractive Lens Glass Sheen */}
              <circle cx="32" cy="32" r="17.5" fill="url(#magnifierLens)" />

              {/* Inside the Lens: Active Cryptographic Reticle & Scanner */}
              <g clipPath="url(#lensClip)">
                {/* Optical Precision Ticks */}
                <line x1="32" y1="17" x2="32" y2="23" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <line x1="32" y1="41" x2="32" y2="47" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <line x1="17" y1="32" x2="23" y2="32" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                <line x1="41" y1="32" x2="47" y2="32" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

                {/* Laser Scanning Beam Sweeping Vertically */}
                <line
                  x1="15"
                  y1="32"
                  x2="49"
                  y2="32"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="verify-lens-laser"
                />

                {/* Glass Light Reflection Highlight Arc */}
                <path
                  d="M20 23 A 15 15 0 0 1 40 18"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              </g>

              {/* Metallic Collar */}
              <circle cx="45.5" cy="45.5" r="3" fill="#10B981" />

              {/* Ergonomic Handle */}
              <path
                d="M46 46 L62 62"
                stroke="#0F172A"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M48 48 L60 60"
                stroke="#334155"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        {/* Status Headline */}
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl sm:text-3xl font-jura font-bold text-stone-900 tracking-tight font-[700]">
            Verifying Certificate Authenticity
          </h1>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 2: VALID / OFFICIALLY VERIFIED (Checkmark & Confetti)
  // -------------------------------------------------------------
  if (state.status === 'valid') {
    return (
      <div className="w-full flex flex-col items-center text-center">
        {/* Celebratory Professional Confetti (Portaled to Full Viewport) */}
        {!confettiComplete && (
          <ConfettiCanvas trigger={true} onComplete={() => setConfettiComplete(true)} />
        )}

        {/* Redesigned High-Definition Verification Seal */}
        <div className="relative flex items-center justify-center verify-pop-badge mb-3">
          {/* Ambient breathing aura glow behind seal */}
          <div className="absolute w-32 h-32 rounded-full bg-emerald-400/25 blur-2xl pointer-events-none verify-aura-breath" />

          {/* Micro-sparkles celebrating verification */}
          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rotate-45 rounded-[1px] verify-sparkle-1 pointer-events-none" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-amber-400 rotate-45 rounded-[1px] verify-sparkle-2 pointer-events-none" />

          <svg className="w-22 h-22 relative z-10 drop-shadow-xs" viewBox="0 0 76 76" fill="none">
            {/* Ambient inner gradient fill disc */}
            <defs>
              <linearGradient id="sealDiscGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ECFDF5" />
                <stop offset="100%" stopColor="#D1FAE5" />
              </linearGradient>
            </defs>
            <circle cx="38" cy="38" r="34" fill="url(#sealDiscGrad)" />
            {/* Animated outer stroke ring */}
            <circle
              cx="38"
              cy="38"
              r="34"
              pathLength={100}
              stroke="#10B981"
              strokeWidth="3.5"
              strokeLinecap="round"
              transform="rotate(-90 38 38)"
              className="verify-circle-draw"
            />
            {/* Animated checkmark vector */}
            <path
              d="M24 38.5 L33.5 48 L52 28"
              pathLength={100}
              stroke="#047857"
              strokeWidth="4.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="verify-check-draw"
            />
          </svg>
        </div>

        {/* Verification Headline */}
        <div className="max-w-md mx-auto mt-2 animate-fade-in" style={{ animationDelay: '150ms' }}>
          <h1 className="text-2xl sm:text-3xl font-jura font-bold text-stone-900 tracking-tight font-[700]">
            Valid Certificate
          </h1>
        </div>

        {/* ----------------------------------------------------------- */}
        {/* Architectural Editorial Layout (Strictly NO Cards/Boxes)   */}
        {/* Harmonious Typography (Jura Values & Quicksand Labels)     */}
        {/* ----------------------------------------------------------- */}
        <div className="w-full mt-8 sm:mt-10 border-y border-stone-300/80 divide-y divide-stone-200/80 text-center sm:text-left">
          {/* Certificate Holder */}
          <div
            className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
            style={{ animationDelay: '240ms' }}
          >
            <span className="font-quicksand font-bold text-xs tracking-[0.14em] uppercase text-stone-500 shrink-0 sm:w-44 select-none font-[700] text-center sm:text-left">
              Certificate Holder
            </span>
            <span className="font-jura font-bold text-base sm:text-lg text-stone-900 break-words text-center sm:text-right font-[700]">
              {state.recipientName}
            </span>
          </div>

          {/* Event */}
          {state.eventName && (
            <div
              className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
              style={{ animationDelay: '320ms' }}
            >
              <span className="font-quicksand font-bold text-xs tracking-[0.14em] uppercase text-stone-500 shrink-0 sm:w-44 select-none font-[700] text-center sm:text-left">
                Event
              </span>
              <span className="font-jura font-bold text-base sm:text-lg text-stone-900 break-words text-center sm:text-right font-[700]">
                {state.eventName}
              </span>
            </div>
          )}

          {/* Registered Email */}
          {state.recipientEmail && (
            <div
              className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
              style={{ animationDelay: '400ms' }}
            >
              <span className="font-quicksand font-bold text-xs tracking-[0.14em] uppercase text-stone-500 shrink-0 sm:w-44 select-none font-[700] text-center sm:text-left">
                Registered Email
              </span>
              <span className="font-jura font-bold text-base sm:text-lg text-stone-900 break-all text-center sm:text-right font-[700]">
                {state.recipientEmail}
              </span>
            </div>
          )}

          {/* Issue Date */}
          <div
            className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
            style={{ animationDelay: '480ms' }}
          >
            <span className="font-quicksand font-bold text-xs tracking-[0.14em] uppercase text-stone-500 shrink-0 sm:w-44 select-none font-[700] text-center sm:text-left">
              Issue Date
            </span>
            <span className="font-jura font-bold text-base sm:text-lg text-stone-900 text-center sm:text-right font-[700]">
              {formatDate(state.issuedAt)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 3: REVOKED (Animated Red Crossmark & Formal Notice)
  // -------------------------------------------------------------
  if (state.status === 'revoked') {
    return (
      <div className="w-full flex flex-col items-center text-center animate-fade-in">
        {/* Animated SVG Red Crossmark */}
        <div className="relative flex items-center justify-center verify-pop-badge mb-3">
          <div className="absolute w-32 h-32 rounded-full bg-red-400/20 blur-2xl pointer-events-none verify-aura-breath" />

          <svg className="w-22 h-22 relative z-10 drop-shadow-xs" viewBox="0 0 76 76" fill="none">
            <circle cx="38" cy="38" r="34" className="fill-red-50" />
            <circle
              cx="38"
              cy="38"
              r="34"
              pathLength={100}
              stroke="#EF4444"
              strokeWidth="3.5"
              strokeLinecap="round"
              transform="rotate(-90 38 38)"
              className="verify-circle-draw"
            />
            <path
              d="M26 26 L50 50"
              pathLength={100}
              stroke="#DC2626"
              strokeWidth="4.2"
              strokeLinecap="round"
              className="verify-cross-draw-1"
            />
            <path
              d="M50 26 L26 50"
              pathLength={100}
              stroke="#DC2626"
              strokeWidth="4.2"
              strokeLinecap="round"
              className="verify-cross-draw-2"
            />
          </svg>
        </div>

        {/* Revocation Headline */}
        <div className="space-y-2 max-w-md mx-auto mt-2">
          <h1 className="text-2xl sm:text-3xl font-jura font-bold text-stone-900 tracking-tight font-[700]">
            Certificate Revoked
          </h1>

          <p className="text-sm sm:text-base font-quicksand font-semibold text-red-700 font-[600] leading-relaxed">
            This certificate is no longer valid. It has been officially revoked in the verification registry.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 4: NOT FOUND / UNVERIFIED
  // -------------------------------------------------------------
  if (state.status === 'not_found') {
    return (
      <div className="w-full flex flex-col items-center text-center animate-fade-in py-8 sm:py-14">
        {/* Animated Amber Query Mark */}
        <div className="relative flex items-center justify-center verify-pop-badge mb-3">
          <div className="absolute w-28 h-28 rounded-full bg-amber-400/20 blur-2xl pointer-events-none" />

          <svg className="w-22 h-22 relative z-10 drop-shadow-xs" viewBox="0 0 76 76" fill="none">
            <circle cx="38" cy="38" r="34" className="fill-amber-50" />
            <circle
              cx="38"
              cy="38"
              r="34"
              pathLength={100}
              stroke="#F59E0B"
              strokeWidth="3.5"
              strokeLinecap="round"
              transform="rotate(-90 38 38)"
              className="verify-circle-draw"
            />
            {/* Question / exclamation stem */}
            <path
              d="M38 24 L38 41 M38 51 L38.02 51"
              stroke="#D97706"
              strokeWidth="4.2"
              strokeLinecap="round"
              className="verify-cross-draw-1"
            />
          </svg>
        </div>

        <div className="space-y-2 max-w-md mx-auto mt-2">
          <h1 className="text-2xl sm:text-3xl font-jura font-bold text-stone-900 tracking-tight font-[700]">
            Certificate Not Found
          </h1>

          <p className="text-sm sm:text-base font-quicksand font-semibold text-stone-600 font-[600] leading-relaxed">
            No issued credential matches this identifier in our verification registry. Please ensure the link or QR code is intact and was generated via Certify.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 5: RATE LIMITED OR SERVICE ERROR
  // -------------------------------------------------------------
  return (
    <div className="w-full flex flex-col items-center text-center animate-fade-in py-10 sm:py-16">
      <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4 text-stone-500 border border-stone-200">
        <AlertTriangle className="w-8 h-8 text-stone-600" />
      </div>

      <div className="space-y-2 max-w-md mx-auto">
        <h1 className="text-2xl sm:text-3xl font-jura font-bold text-stone-900 tracking-tight font-[700]">
          {state.status === 'rate_limited' ? 'Too Many Requests' : 'Verification Unavailable'}
        </h1>

        <p className="text-sm sm:text-base font-quicksand font-semibold text-stone-600 font-[600] leading-relaxed">
          {state.status === 'rate_limited'
            ? state.detail || 'Rate limit reached. Please wait a moment before trying again.'
            : state.detail || 'The verification service is momentarily unable to reach the registry.'}
        </p>
      </div>

      <div className="mt-7">
        <button
          type="button"
          onClick={fetchVerification}
          className="inline-flex items-center gap-2 px-4.5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-saira font-bold tracking-wider uppercase transition-all shadow-2xs hover:shadow-xs active:scale-[0.98] font-[700]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Try Again</span>
        </button>
      </div>
    </div>
  );
}
