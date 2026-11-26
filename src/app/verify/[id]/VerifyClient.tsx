'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  Link2,
  Check,
  Clock,
} from 'lucide-react';
import { ConfettiCanvas } from '@/components/verify/ConfettiCanvas';
import { CertificatePreview, type CertificateAssetSpec } from '@/components/verify/CertificatePreview';
import { getAuthToken } from '@/lib/api-client';

type VerifyResponse =
  | {
      status: 'valid';
      recipientName: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt: string;
      issuedBy?: string | null;
      expiresAt?: string | null;
      expired?: boolean;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InFlightVerifyBatch {
  verifyPromise: Promise<VerifyResponse> | null;
  assetPromise: Promise<CertificateAssetSpec | null> | null;
}

const inFlightVerifyBatches = new Map<string, InFlightVerifyBatch>();

function fetchAssetSpec(encodedId: string): Promise<CertificateAssetSpec | null> | null {
  return UUID_RE.test(decodeURIComponent(encodedId).trim())
    ? fetch(`/api/verify/${encodedId}/asset`)
        .then((res) => (res.ok ? (res.json() as Promise<CertificateAssetSpec>) : null))
        .catch(() => null)
    : null;
}

function loadVerifyBatch(
  id: string,
  token: string | null,
  forceRefresh: boolean
): InFlightVerifyBatch {
  const key = `${id}|${token ? 'auth' : 'anon'}`;
  if (!forceRefresh) {
    const existing = inFlightVerifyBatches.get(key);
    if (existing) return existing;
  }

  const encodedId = encodeURIComponent(id);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // Start status + render spec fetches together for valid IDs, deduplicated
  // across React StrictMode remounts so dev never fires duplicate DB queries.
  const verifyPromise = fetch(`/api/verify/${encodedId}`, { headers })
    .then(async (res) => (await res.json().catch(() => ({ status: 'error' }))) as VerifyResponse)
    .catch(() => ({ status: 'error' }) as VerifyResponse);

  const assetPromise = fetchAssetSpec(encodedId);

  const entry: InFlightVerifyBatch = { verifyPromise, assetPromise };
  inFlightVerifyBatches.set(key, entry);
  void verifyPromise.finally(() => {
    setTimeout(() => {
      if (inFlightVerifyBatches.get(key) === entry) {
        inFlightVerifyBatches.delete(key);
      }
    }, 250);
  });

  return entry;
}

export function VerifyClient({
  id,
  defaultIssuedBy,
  initialResult,
}: {
  id: string;
  defaultIssuedBy?: string;
  initialResult?: VerifyResponse;
}) {
  const [state, setState] = useState<'loading' | VerifyResponse>(initialResult ?? 'loading');
  const [confettiComplete, setConfettiComplete] = useState(false);
  const [previewAvailable, setPreviewAvailable] = useState(true);
  const [prefetchedAsset, setPrefetchedAsset] = useState<Promise<CertificateAssetSpec | null> | null>(null);

  const requestSeqRef = useRef(0);

  const fetchVerification = (forceRefresh = false) => {
    setState('loading');
    setConfettiComplete(false);
    setPreviewAvailable(true);
    const requestSeq = ++requestSeqRef.current;
    let cancelled = false;
    const isStale = () => cancelled || requestSeq !== requestSeqRef.current;

    const { verifyPromise, assetPromise } = loadVerifyBatch(id, getAuthToken(), forceRefresh);
    setPrefetchedAsset(assetPromise);

    verifyPromise?.then((data) => {
      if (!isStale()) setState(data);
    });

    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const token = getAuthToken();
    if (initialResult && initialResult.status !== 'error' && !token) {
      return;
    }

    const cancel = fetchVerification();
    return () => {
      if (cancel) cancel();
    };
  }, [id, initialResult]);

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
      <div className="w-full flex flex-col items-center justify-center text-center animate-fade-in">
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
          <h1 className="page-title text-stone-900">
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
      <div className="w-full">
        {/* Celebratory Professional Confetti (Portaled to Full Viewport) */}
        {!state.expired && !confettiComplete && (
          <ConfettiCanvas trigger={true} onComplete={() => setConfettiComplete(true)} />
        )}

        {/* ----------------------------------------------------------- */}
        {/* Editorial two-column layout: large certificate showcase on  */}
        {/* the left (~60%), centered validation seal + record + share  */}
        {/* stack vertically aligned on the right (~40%).               */}
        {/* ----------------------------------------------------------- */}
        <div
          className={
            previewAvailable
              ? 'w-full grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12 xl:gap-16 items-center'
              : 'w-full max-w-lg mx-auto'
          }
        >
          {previewAvailable && (
            <CertificatePreview
              certificateId={id}
              recipientName={state.recipientName}
              prefetchedAsset={prefetchedAsset}
              onAvailabilityChange={setPreviewAvailable}
            />
          )}

          <div className="w-full max-w-md mx-auto flex flex-col items-center text-center">
            {/* Redesigned High-Definition Verification Seal */}
            {state.expired ? (
              <Clock aria-hidden="true" className="mb-3 h-16 w-16 text-amber-600" />
            ) : (
              <div className="relative flex items-center justify-center verify-pop-badge mb-3">
                {/* Ambient breathing aura glow behind seal */}
                <div className="absolute w-32 h-32 rounded-full bg-emerald-400/25 blur-2xl pointer-events-none verify-aura-breath" />

                {/* Micro-sparkles celebrating verification */}
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rotate-45 rounded-[1px] verify-sparkle-1 pointer-events-none" />
                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-amber-400 rotate-45 rounded-[1px] verify-sparkle-2 pointer-events-none" />

                <svg className="w-20 h-20 relative z-10 drop-shadow-xs" viewBox="0 0 76 76" fill="none">
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
            )}

            {/* Verification Headline */}
            <div className="w-full mt-1 animate-fade-in" style={{ animationDelay: '150ms' }}>
              <h1 className="page-title text-stone-900">
                {state.expired ? 'Expired Certificate' : 'Valid Certificate'}
              </h1>
              {state.expired && state.expiresAt && (
                <div
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50"
                  role="status"
                >
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-xs sm:text-sm font-semibold text-amber-800 text-left">
                    This credential expired on {formatDate(state.expiresAt)} and is no longer current.
                  </p>
                </div>
              )}
            </div>

            <div className="w-full mt-7 border-y border-stone-300/80 divide-y divide-stone-200/80 text-center sm:text-left">
              {/* Certificate Holder */}
              <div
                className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
                style={{ animationDelay: '240ms' }}
              >
                <span className="text-sm font-medium text-stone-700 shrink-0 sm:w-40 text-center sm:text-left">
                  Certificate Holder
                </span>
                <span className="text-sm font-semibold text-stone-900 break-words text-center sm:text-right">
                  {state.recipientName}
                </span>
              </div>

              {/* Event */}
              {state.eventName && (
                <div
                  className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
                  style={{ animationDelay: '320ms' }}
                >
                  <span className="text-sm font-medium text-stone-700 shrink-0 sm:w-40 text-center sm:text-left">
                    Event
                  </span>
                  <span className="text-sm font-semibold text-stone-900 break-words text-center sm:text-right">
                    {state.eventName}
                  </span>
                </div>
              )}

              {/* Issued By (account-level issuer name) */}
              {(state.issuedBy || defaultIssuedBy) && (
                <div
                  className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
                  style={{ animationDelay: '360ms' }}
                >
                  <span className="text-sm font-medium text-stone-700 shrink-0 sm:w-40 text-center sm:text-left">
                    Issued By
                  </span>
                  <span className="text-sm font-semibold text-stone-900 break-words text-center sm:text-right">
                    {state.issuedBy || defaultIssuedBy}
                  </span>
                </div>
              )}

              {/* Registered Email */}
              {state.recipientEmail && (
                <div
                  className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
                  style={{ animationDelay: '400ms' }}
                >
                  <span className="text-sm font-medium text-stone-700 shrink-0 sm:w-40 text-center sm:text-left">
                    Registered Email
                  </span>
                  <span className="text-sm font-semibold text-stone-900 break-all text-center sm:text-right">
                    {state.recipientEmail}
                  </span>
                </div>
              )}

              {/* Issue Date */}
              <div
                className="py-3.5 sm:py-4 flex flex-col items-center sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 verify-row-animate text-center sm:text-left"
                style={{ animationDelay: '480ms' }}
              >
                <span className="text-sm font-medium text-stone-700 shrink-0 sm:w-40 text-center sm:text-left">
                  Issue Date
                </span>
                <span className="text-sm font-semibold text-stone-900 text-center sm:text-right">
                  {formatDate(state.issuedAt)}
                </span>
              </div>
            </div>

            <ShareRow eventName={state.eventName ?? ''} issuedBy={state.issuedBy || defaultIssuedBy || ''} />
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
          <h1 className="page-title text-stone-900">
            Certificate Revoked
          </h1>

          <p className="text-sm sm:text-base font-semibold text-red-700 font-[600] leading-relaxed">
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
      <div className="w-full flex flex-col items-center justify-center text-center animate-fade-in">
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
          <h1 className="page-title text-stone-900">
            Certificate Not Found
          </h1>

          <p className="text-sm sm:text-base font-semibold text-stone-600 font-[600] leading-relaxed">
            No issued credential matches this identifier in our verification registry. Please ensure the link or QR code is intact and was generated via WeCertify.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 5: RATE LIMITED OR SERVICE ERROR
  // -------------------------------------------------------------
  return (
    <div className="w-full flex flex-col items-center justify-center text-center animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4 text-stone-500 border border-stone-200">
        <AlertTriangle className="w-8 h-8 text-stone-600" />
      </div>

      <div className="space-y-2 max-w-md mx-auto">
        <h1 className="page-title text-stone-900">
          {state.status === 'rate_limited' ? 'Too Many Requests' : 'Verification Unavailable'}
        </h1>

        <p className="text-sm sm:text-base font-semibold text-stone-600 font-[600] leading-relaxed">
          {state.status === 'rate_limited'
            ? state.detail || 'Rate limit reached. Please wait a moment before trying again.'
            : state.detail || 'The verification service is momentarily unable to reach the registry.'}
        </p>
      </div>

      <div className="mt-7">
        <button
          type="button"
          onClick={() => fetchVerification(true)}
          className="inline-flex items-center gap-2 px-4.5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm font-semibold transition-all shadow-2xs hover:shadow-xs active:scale-[0.98]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Try Again</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Share actions under the verification record: LinkedIn "Add to profile",
 * an X post, and copy-link. Recipient sharing is the product's organic
 * growth loop — every post links back to this verification page.
 */
function ShareRow({ eventName, issuedBy }: { eventName: string; issuedBy: string }) {
  const [copied, setCopied] = useState(false);
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const certName = eventName ? `${eventName} certificate` : 'This verified certificate';
  const enc = encodeURIComponent;

  const linkedIn = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION&name=${enc(certName)}&organizationName=${enc(issuedBy)}&certUrl=${enc(pageUrl)}`;
  const tweet = `https://twitter.com/intent/tweet?text=${enc(`I earned ${certName}${issuedBy ? ` from ${issuedBy}` : ''} — verify it here:`)}&url=${enc(pageUrl)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — ignore.
    }
  };

  return (
    <div className="w-full max-w-md mx-auto mt-6 flex items-center justify-center gap-2 flex-wrap animate-fade-in" style={{ animationDelay: '560ms' }}>
      <a
        href={linkedIn}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:border-stone-500 hover:bg-stone-50 transition-colors"
      >
        <LinkedInGlyph className="w-3.5 h-3.5 text-[#0a66c2]" />
        Add to LinkedIn
      </a>
      <a
        href={tweet}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:border-stone-500 hover:bg-stone-50 transition-colors"
      >
        <XGlyph className="w-3 h-3 text-stone-900" />
        Share on X
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:border-stone-500 hover:bg-stone-50 transition-colors cursor-pointer"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Copied!
          </>
        ) : (
          <>
            <Link2 className="w-3.5 h-3.5 text-stone-400" />
            Copy link
          </>
        )}
      </button>
    </div>
  );
}


function LinkedInGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

function XGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z" />
    </svg>
  );
}
