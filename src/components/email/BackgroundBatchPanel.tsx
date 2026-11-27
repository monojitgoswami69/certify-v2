'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cancelBackgroundMailBatch,
  enqueueBackgroundMailBatch,
  fetchBatchStatus,
  fetchEventMailBatchStatus,
  startBatchAuthorization,
  type BackgroundMailBatchSummary,
} from '../../lib/api-client';
import type { EmailSettings } from '../../types';

const ACTIVE_STATUSES = new Set<BackgroundMailBatchSummary['status']>([
  'awaiting_auth',
  'queued',
  'running',
  'paused_auth',
  'paused_rate_limit',
  'cancelling',
]);

const STATUS_LABELS: Record<BackgroundMailBatchSummary['status'], string> = {
  awaiting_auth: 'Waiting for Gmail authorization',
  queued: 'Queued for background worker',
  running: 'Sending in background',
  paused_auth: 'Paused — Gmail re-authorization needed',
  paused_rate_limit: 'Paused briefly for Gmail rate limit',
  cancelling: 'Stopping batch…',
  cancelled: 'Batch cancelled',
  completed: 'Background batch finished',
  failed: 'Background batch failed',
};

function waitForOAuthCallback(popup: Window, targetBatchId: string, authUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const channel = typeof BroadcastChannel === 'function'
      ? new BroadcastChannel('wecertify-worker-oauth') : null;
    const finish = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timeout);
      channel?.close();
      resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      if (event.data?.type === 'wecertify-worker-oauth') finish();
    };
    channel?.addEventListener('message', (event) => {
      if (event.data?.batchId === targetBatchId && event.data?.status === 'authorized') finish();
    });
    const timeout = setTimeout(finish, 45_000);
    window.addEventListener('message', onMessage);
    popup.location.replace(authUrl);
  });
}

function reserveOAuthWindow() {
  return window.open('about:blank', '_blank', 'width=540,height=680,menubar=no,toolbar=no,status=no');
}

export function BackgroundBatchPanel({
  eventId,
  eligibleCertificateIds,
  mailPreferences,
  onBatchProgress,
}: {
  eventId: string | null;
  eligibleCertificateIds: string[];
  mailPreferences?: EmailSettings | null;
  onBatchProgress?: () => void | Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [batch, setBatch] = useState<BackgroundMailBatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!eventId) return;
      const res = await fetchEventMailBatchStatus(eventId, signal);
      setEnabled(Boolean(res.enabled));
      setBatch(res.latestBatch);
    },
    [eventId]
  );

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [eventId, refresh]);

  useEffect(() => {
    if (!batch || !ACTIVE_STATUSES.has(batch.status)) return;
    const intervalMs = batch.status === 'running' || batch.status === 'queued' ? 2500 : 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchBatchStatus(batch.id, controller.signal)
        .then(async ({ batch: next }) => {
          if (controller.signal.aborted) return;
          setBatch(next);
          if (onBatchProgress && (next.counts.accepted !== batch.counts.accepted || !ACTIVE_STATUSES.has(next.status))) {
            await onBatchProgress();
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setBatch((current) => current?.id === batch.id ? { ...current } : current);
        });
    }, intervalMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [batch, onBatchProgress]);

  if (!enabled || !eventId) return null;

  const hasActiveBatch = Boolean(batch && ACTIVE_STATUSES.has(batch.status));
  const needsAuth = batch?.status === 'awaiting_auth' || batch?.status === 'paused_auth';
  const canEnqueue = !hasActiveBatch && eligibleCertificateIds.length > 0 && Boolean(mailPreferences?.attachPdf || mailPreferences?.attachPng);

  async function authorizeBatch(targetBatchId: string, popup: Window | null) {
    try {
      const { authUrl } = await startBatchAuthorization(targetBatchId);
      if (!popup || popup.closed) {
        window.location.assign(authUrl);
        return;
      }
      await waitForOAuthCallback(popup, targetBatchId, authUrl);
      await refresh();
    } catch (err) {
      popup?.close();
      throw err;
    }
  }

  async function handleStartBackground() {
    if (!eventId || busy || !canEnqueue) return;
    const popup = reserveOAuthWindow();
    setError('');
    setBusy(true);
    try {
      const { batch: created } = await enqueueBackgroundMailBatch({
        eventId,
        certificateIds: eligibleCertificateIds,
        mailPreferences: mailPreferences ?? undefined,
      });
      setBatch(created);
      if (created.status === 'awaiting_auth' || created.status === 'paused_auth') {
        await authorizeBatch(created.id, popup);
      } else {
        popup?.close();
      }
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : 'Could not start background mailing.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthorize() {
    if (!batch || busy) return;
    const popup = reserveOAuthWindow();
    setError('');
    setBusy(true);
    try {
      await authorizeBatch(batch.id, popup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!batch || busy) return;
    setError('');
    setBusy(true);
    try {
      const { batch: next } = await cancelBackgroundMailBatch(batch.id);
      setBatch(next);
      if (onBatchProgress) await onBatchProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel batch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-stone-200 pt-3 mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-900">Background delivery</span>
        {!hasActiveBatch && (
          <button
            type="button"
            disabled={busy || !canEnqueue}
            onClick={() => void handleStartBackground()}
            className="text-xs font-semibold underline underline-offset-4 text-slate-900 disabled:opacity-40 cursor-pointer"
          >
            {busy ? 'Starting…' : `Run in background (${eligibleCertificateIds.length})`}
          </button>
        )}
      </div>

      <p className="text-xs text-stone-600">
        Delivery continues after you close this tab. We’ll ask you to reconnect Gmail if your authorization expires.
      </p>

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      {batch && (
        <div className="border-t border-stone-200/70 pt-2 space-y-1.5 text-xs">
          <p role="status" className="font-semibold text-slate-800">{STATUS_LABELS[batch.status]}</p>
          <p className="text-stone-700">
            {batch.counts.accepted} / {batch.totalItems} accepted by Gmail
            {batch.counts.queued + batch.counts.rendering + batch.counts.sending > 0
              ? ` · ${batch.counts.queued + batch.counts.rendering + batch.counts.sending} remaining`
              : ''}
            {batch.counts.failed > 0 ? ` · ${batch.counts.failed} failed` : ''}
            {batch.counts.unknown > 0 ? ` · ${batch.counts.unknown} unconfirmed` : ''}
            {batch.counts.skipped > 0 ? ` · ${batch.counts.skipped} skipped` : ''}
          </p>
          {batch.statusReason && <p className="text-stone-600">{batch.statusReason}</p>}
          {batch.recentFailures.length > 0 && (
            <ul className="divide-y divide-stone-200/70 pt-1 text-stone-700">
              {batch.recentFailures.slice(0, 5).map((item) => (
                <li key={item.itemId} className="py-1">
                  {item.certificateId.slice(0, 8)}… · {item.status} — {item.errorDetail || item.errorCode || 'Delivery issue'}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-4 pt-1 font-semibold">
            {needsAuth && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAuthorize()}
                className="underline underline-offset-4 text-slate-900 disabled:opacity-40 cursor-pointer"
              >
                {batch.status === 'paused_auth' ? 'Re-authorize Gmail to resume' : 'Authorize Gmail sending'}
              </button>
            )}
            {hasActiveBatch && batch.status !== 'cancelling' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCancel()}
                className="underline underline-offset-4 text-red-700 disabled:opacity-40 cursor-pointer"
              >
                Cancel background batch
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
