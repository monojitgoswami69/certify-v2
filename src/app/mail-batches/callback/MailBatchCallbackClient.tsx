'use client';

import { useEffect } from 'react';
import Link from 'next/link';

const REASON_MESSAGES: Record<string, string> = {
  cancelled: 'Google authorization was cancelled before granting permission.',
  provider_error: 'Google returned an authorization error. Please try again.',
  unauthorized: 'Your WeCertify session expired. Sign in again and retry authorization.',
  invalid_callback: 'The authorization callback was missing required OAuth parameters.',
  rejected: 'The authorization state expired or belonged to another request.',
  failed: 'Could not hand off authorization to the background worker.',
};

export function MailBatchCallbackClient({
  status,
  batchId,
  eventId,
  reason,
}: {
  status: 'authorized' | 'error';
  batchId: string;
  eventId: string;
  reason: string;
}) {
  useEffect(() => {
    const result = { type: 'wecertify-worker-oauth', status, batchId, eventId, reason };
    if (typeof BroadcastChannel === 'function' && status === 'authorized') {
      const channel = new BroadcastChannel('wecertify-worker-oauth');
      channel.postMessage(result);
      channel.close();
    }
    window.opener?.postMessage(result, window.location.origin);
    if (status === 'authorized' && (window.opener || window.history.length <= 1)) window.close();
  }, [status, batchId, eventId, reason]);

  const returnHref = eventId ? `/dashboard?eventId=${encodeURIComponent(eventId)}` : '/dashboard';
  const detail =
    status === 'authorized'
      ? 'Gmail authorization was handed off to the background queue. You can close this tab cleanly.'
      : REASON_MESSAGES[reason] || 'Background Gmail authorization could not be completed.';

  return (
    <main className="min-h-screen bg-[#FBFAF5] text-slate-900 flex flex-col justify-center px-6 py-16">
      <div className="max-w-lg mx-auto w-full border-t border-b border-stone-200 py-10 space-y-4">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500">
          WeCertify Background Delivery
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {status === 'authorized' ? 'Background mailing authorized' : 'Authorization not completed'}
        </h1>
        <p className="text-sm leading-relaxed text-stone-700">{detail}</p>
        <div className="pt-2 flex flex-wrap gap-6 text-sm font-semibold">
          <Link href={returnHref} className="underline underline-offset-4 text-slate-900">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
