'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldX, SearchX, Loader2, Mail, Calendar, CalendarDays, Copy, Check } from 'lucide-react';

type VerifyResponse =
  | {
      status: 'valid';
      recipientName: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt: string;
    }
  | {
      status: 'revoked';
      recipientName: string;
      recipientEmail?: string | null;
      eventName?: string | null;
      issuedAt: string;
    }
  | { status: 'not_found' }
  | { status: 'rate_limited'; detail?: string }
  | { status: 'error'; detail?: string };

export function VerifyClient({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | VerifyResponse>('loading');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/verify/${id}`)
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
  }, [id]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm font-medium">Verifying certificate authenticity…</p>
      </div>
    );
  }

  if (state.status === 'valid') {
    return (
      <div className="flex flex-col items-center gap-5 py-6 sm:py-8 text-center">
        {/* Verification Badge */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center shadow-sm">
          <ShieldCheck className="w-9 h-9 text-emerald-600" />
        </div>
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Officially Verified
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Valid Certificate</h1>
          <p className="text-sm text-slate-600 font-medium mt-1 max-w-sm mx-auto">
            This certificate was officially issued and recorded in the verification registry.
          </p>
        </div>

        {/* Certificate Details Card */}
        <div className="w-full max-w-md bg-slate-50/90 border border-slate-200/90 rounded-2xl p-5 sm:p-6 text-left space-y-4">
          {/* Recipient Name */}
          <div className="border-b border-slate-200/80 pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Certificate Holder
            </span>
            <span className="text-base sm:text-lg font-bold text-slate-900 block break-words">
              {state.recipientName}
            </span>
          </div>

          {/* Registered Email */}
          {state.recipientEmail && (
            <div className="border-b border-slate-200/80 pb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Registered Email Address
              </span>
              <span className="text-sm font-semibold text-slate-800 block break-all font-mono">
                {state.recipientEmail}
              </span>
            </div>
          )}

          {/* Event Name */}
          {state.eventName && (
            <div className="border-b border-slate-200/80 pb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1">
                <CalendarDays className="w-3.5 h-3.5 text-primary-500" />
                Event / Course
              </span>
              <span className="text-sm font-semibold text-slate-800 block break-words">
                {state.eventName}
              </span>
            </div>
          )}

          {/* Issue Date */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Issue Date
            </span>
            <span className="text-sm font-semibold text-slate-800 block">
              {formatDate(state.issuedAt)}
            </span>
          </div>
        </div>

        {/* Certificate Unique ID Pill with Copy button */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500 font-mono">
          <span className="truncate max-w-[200px] sm:max-w-xs">{id}</span>
          <button
            onClick={handleCopyId}
            className="p-1 hover:text-slate-800 transition-colors"
            title="Copy Certificate ID"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'revoked') {
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center">
          <ShieldX className="w-9 h-9 text-red-600" />
        </div>
        <div>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200 mb-2">
            Status: Revoked
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Certificate Revoked</h1>
          <p className="text-sm text-red-600 font-medium mt-1 max-w-xs mx-auto">
            This certificate is no longer valid. Contact the issuer for details.
          </p>
        </div>

        <div className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
              Issued To
            </span>
            <span className="text-sm font-semibold text-slate-800 block">
              {state.recipientName}
            </span>
          </div>
          {state.eventName && (
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Event
              </span>
              <span className="text-sm font-semibold text-slate-800 block">
                {state.eventName}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 font-mono">
          ID: {id}
        </p>
      </div>
    );
  }

  if (state.status === 'rate_limited') {
    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center">
        <Loader2 className="w-10 h-10 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-900">Too Many Requests</h1>
        <p className="text-sm text-slate-500 max-w-xs">
          {state.detail || 'Please wait a moment before verifying again.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
        <SearchX className="w-9 h-9 text-slate-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Certificate Not Found</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-xs mx-auto">
          This certificate could not be verified. Ensure the QR code or verification link is intact and was officially issued through Credify.
        </p>
      </div>
    </div>
  );
}
