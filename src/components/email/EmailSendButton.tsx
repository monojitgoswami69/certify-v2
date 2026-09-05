'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Pause, Play, X, Loader2, CheckCircle2, AlertCircle, RefreshCw, Download, Clock, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { sendEmailV2 } from '../../lib/api-client';
import { replaceTemplateVariables, delay, downloadErrorReport, sanitizeFilename, validateEmailAddress } from '../../lib/utils';
import { generateCertificate } from '../../lib/certificate-engine';
import { ensureFontsLoaded } from '../../lib/font-loader';
import { ensureCertificateIds, buildVerifyUrlFor } from '../../lib/cert-registration';
import type { CsvRow, EmailProgress } from '../../types';

interface FailedRecord {
  rowIndex: number;
  name: string;
  email: string;
  row: CsvRow;
  error: string;
}

interface EmailLogs {
  firstSent: Date | null;
  lastSent: Date | null;
  totalElapsed: number;
}

export function EmailSendButton() {
  const {
    templateImage,
    templateFile,
    csvData,
    boxes,
    emailColumn,
    emailSettings,
    emailProgress,
    qrZones,
    setEmailProgress,
    resetEmailProgress,
    setError,
  } = useAppStore();

  const [logs, setLogs] = useState<EmailLogs>({ firstSent: null, lastSent: null, totalElapsed: 0 });
  const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const reconnectRef = useRef(false);
  const [localPaused, setLocalPaused] = useState(false);
  const startTimeRef = useRef<number>(0);
  const [, setEtaTick] = useState(0);
  // rowIndex -> verification id, survives "Retry Failed" so retried rows are
  // not re-registered in the database.
  const certIdsRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (emailProgress.status !== 'sending') return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [emailProgress.status]);

  const { connectedGoogleAccount, setConnectedGoogleAccount, eventName } = useAppStore();
  const hasMailingAccount = Boolean(connectedGoogleAccount);

  const validBoxes = boxes.filter((b) => b.field);
  const attachImage = Boolean(emailSettings.attachJpg || emailSettings.attachPng);
  const isReady =
    templateImage &&
    csvData.length > 0 &&
    validBoxes.length > 0 &&
    emailColumn &&
    hasMailingAccount &&
    (emailSettings.attachPdf || attachImage);

  const getDisplayName = useCallback(
    (row: CsvRow): string => {
      const nameBox = boxes.find((b) => b.field.toLowerCase().includes('name'));
      if (nameBox && row[nameBox.field]) {
        return row[nameBox.field];
      }
      if (validBoxes.length > 0 && row[validBoxes[0].field]) {
        return row[validBoxes[0].field];
      }
      return 'Recipient';
    },
    [boxes, validBoxes]
  );

  const sendBatch = useCallback(
    async (records: Array<{ rowIndex: number; row: CsvRow }>, isRetry: boolean = false) => {
      if (!templateImage || validBoxes.length === 0) return;

      abortRef.current = false;
      pauseRef.current = false;
      setLocalPaused(false);
      setError(null);

      const startTime = Date.now();
      startTimeRef.current = startTime;
      const errors: FailedRecord[] = [];
      const sent: Array<{ rowIndex: number; name: string; email: string }> = [];
      let completedCount = 0;
      let firstSentAt: Date | null = null;
      let lastSentAt: Date | null = null;

      setEmailProgress({
        current: 0,
        total: records.length,
        currentRecipient: 'Initializing parallel pipeline...',
        status: 'sending',
        errors: [],
        sent: [],
      });

      const uniqueFonts = new Set(boxes.map((b) => b.fontFamily).filter(Boolean));
      await ensureFontsLoaded(uniqueFonts);

      if (!isRetry) {
        setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
      }

      reconnectRef.current = false;
      setNeedsReconnect(false);

      // QR verification mode: register every pending row BEFORE rendering so
      // each certificate's QR encodes an id that already exists server-side.
      const useQr = qrZones.length > 0;
      if (useQr) {
        try {
          setEmailProgress({
            current: 0,
            total: records.length,
            currentRecipient: 'Registering certificates...',
            status: 'sending',
            errors: [],
            sent: [],
          });
          certIdsRef.current = await ensureCertificateIds({
            records,
            existingIds: certIdsRef.current,
            getDisplayName: getDisplayName,
            getEmail: (row) => (row[emailColumn] || '').trim(),
            templateName: templateFile?.name || 'template',
            eventName: eventName || 'General Event',
          });
        } catch (err) {
          setError(
            `QR registration failed: ${err instanceof Error ? err.message : 'unknown error'}. ` +
              'Batch aborted — no emails were sent with unverifiable QR codes.'
          );
          resetEmailProgress();
          return;
        }
      }

      // Fixed Constant Parallel Worker Pool (10 workers continuous stream)
      const concurrency = Math.min(10, records.length);
      let recordIndex = 0;

      // Throttled progress reporting: avoid O(n^2) array copies on every
      // record. We push live array references (no clone) at most ~4x/sec.
      let lastProgressAt = 0;
      const PROGRESS_INTERVAL_MS = 250;
      const flushProgress = (displayName: string, force: boolean = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
        lastProgressAt = now;
        setEmailProgress({
          current: completedCount,
          currentRecipient: displayName,
          errors: errors as unknown as EmailProgress['errors'],
          sent,
        });
      };

      // Proactive Gmail API quota limiter, shared across all workers.
      // Your verified Cloud Console quota: "Units per minute per user" =
      // 15,000. messages.send = 100 units => 150 sends/min = 2.5/sec ceiling.
      // Your 649-mail run actually sustained ~2/sec (120/min) — so you were
      // network/concurrency-bound, NOT quota-bound (120 < 150). Set the cap
      // just under your real quota (145/min ~ 2.4/sec) so the limiter never
      // binds below your network capacity and only guards against quota
      // spikes; the retry path catches any stragglers. If you raise the
      // Cloud Console quota or your env sets NEXT_PUBLIC_GMAIL_QUOTA_PER_MINUTE,
      // it overrides this default.
      const GMAIL_BURST_PER_SECOND = Number(
        process.env.NEXT_PUBLIC_GMAIL_BURST_PER_SECOND ?? 8
      );
      const GMAIL_QUOTA_PER_MINUTE = Number(
        process.env.NEXT_PUBLIC_GMAIL_QUOTA_PER_MINUTE ?? 145
      );
      const secondWindow: number[] = [];
      const minuteWindow: number[] = [];
      const acquireSendSlot = async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (abortRef.current || reconnectRef.current) return;
          const now = Date.now();
          while (secondWindow.length && now - secondWindow[0] >= 1000) secondWindow.shift();
          while (minuteWindow.length && now - minuteWindow[0] >= 60000) minuteWindow.shift();

          if (minuteWindow.length >= GMAIL_QUOTA_PER_MINUTE) {
            // Minute quota exhausted -> wait until the oldest send falls out
            // of the window (~1/sec tick).
            await delay(Math.max(50, 60000 - (now - minuteWindow[0]) + 10));
            continue;
          }
          if (secondWindow.length >= GMAIL_BURST_PER_SECOND) {
            // Burst cap -> wait until the oldest send in this second ages out.
            await delay(Math.max(50, 1000 - (now - secondWindow[0]) + 10));
            continue;
          }
          secondWindow.push(now);
          minuteWindow.push(now);
          return;
        }
      };

      const worker = async () => {
        // Each worker reuses a single canvas across its records to avoid
        // per-record allocation/GC churn.
        let workerCanvas: HTMLCanvasElement | undefined;

        while (recordIndex < records.length && !abortRef.current && !reconnectRef.current) {
          while (pauseRef.current && !abortRef.current && !reconnectRef.current) {
            await delay(100);
          }

          if (abortRef.current || reconnectRef.current) return;

          const currentIndex = recordIndex++;
          if (currentIndex >= records.length) return;

          const record = records[currentIndex];
          const { rowIndex, row } = record;
          const displayName = getDisplayName(row);
          const rawEmail = row[emailColumn] || '';

          const validation = validateEmailAddress(rawEmail);
          if (!validation.valid) {
            errors.push({
              rowIndex,
              name: displayName || '(empty)',
              email: rawEmail || '(empty)',
              row,
              error: validation.warning || 'Invalid email address syntax',
            });
            completedCount++;
            flushProgress(displayName || '(skipped)');
            continue;
          }

          const email = validation.email;

          try {
            if (!workerCanvas) workerCanvas = document.createElement('canvas');
            const certId = certIdsRef.current.get(rowIndex);
            const cert = await generateCertificate({
              templateImage,
              boxes: validBoxes,
              row,
              filename: sanitizeFilename(displayName),
              includeJpg: Boolean(emailSettings.attachJpg),
              includePng: Boolean(emailSettings.attachPng),
              includePdf: Boolean(emailSettings.attachPdf),
              canvas: workerCanvas,
              qrZones: useQr ? qrZones : undefined,
              verificationUrl: useQr && certId ? buildVerifyUrlFor(certId) : undefined,
            });

            const subject = replaceTemplateVariables(emailSettings.subject, row);
            const bodyPlain = replaceTemplateVariables(emailSettings.bodyPlain, row);
            const bodyHtml = emailSettings.bodyHtml.trim()
              ? replaceTemplateVariables(emailSettings.bodyHtml, row)
              : '';

            await acquireSendSlot();
            if (abortRef.current || reconnectRef.current) return;

            const result = await sendEmailV2({
              recipientEmail: email,
              emailSubject: subject,
              emailBodyPlain: bodyPlain,
              emailBodyHtml: bodyHtml,
              filename: cert.filename,
              jpgBlob: cert.jpgBlob,
              pngBlob: cert.pngBlob,
              pdfBlob: cert.pdfBlob,
              googleAccessToken: connectedGoogleAccount?.accessToken,
              senderEmail: connectedGoogleAccount?.email,
            });

            if (result.status === 'reconnect_required') {
              // Google session is dead. Stop the whole batch and surface a
              // reconnect prompt instead of burning the remaining quota.
              reconnectRef.current = true;
              setNeedsReconnect(true);
              errors.push({
                rowIndex,
                name: displayName,
                email,
                row,
                error: 'Google session expired — reconnect required',
              });
              completedCount++;
              flushProgress(displayName, true);
              return;
            }

            sent.push({ rowIndex, name: displayName, email });
            completedCount++;

            if (!firstSentAt) firstSentAt = new Date();
            lastSentAt = new Date();

            flushProgress(displayName);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to send';
            errors.push({ rowIndex, name: displayName, email, row, error: errorMsg });
            completedCount++;
            flushProgress(displayName);
          }
        }
      };

      // Launch worker pool with 40ms micro-stagger for smooth network flow
      const workers = Array.from({ length: concurrency }, async (_, idx) => {
        await delay(idx * 40);
        return worker();
      });
      await Promise.all(workers);

      setEmailProgress({
        current: completedCount,
        total: records.length,
        currentRecipient: '',
        status: 'completed',
        errors: errors as unknown as EmailProgress['errors'],
        sent,
      });

      setLogs({
        firstSent: firstSentAt,
        lastSent: lastSentAt,
        totalElapsed: Date.now() - startTime,
      });

      setRetryQueue(errors);
    },
    [
      templateImage,
      templateFile,
      boxes,
      validBoxes,
      emailColumn,
      emailSettings,
      qrZones,
      setEmailProgress,
      resetEmailProgress,
      setError,
      getDisplayName,
      connectedGoogleAccount,
    ]
  );

  const handleSend = useCallback(async () => {
    const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
    await sendBatch(records, false);
  }, [csvData, sendBatch]);

  const handleRetry = useCallback(async () => {
    const records = retryQueue.map((err) => ({ rowIndex: err.rowIndex, row: err.row }));
    await sendBatch(records, true);
  }, [retryQueue, sendBatch]);

  const handlePauseResume = () => {
    pauseRef.current = !pauseRef.current;
    setLocalPaused(pauseRef.current);
    setEmailProgress({ status: pauseRef.current ? 'paused' : 'sending' });
  };

  const handleStop = () => {
    abortRef.current = true;
    pauseRef.current = false;
    setLocalPaused(false);
  };

  const handleDone = () => {
    resetEmailProgress();
    setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
    setRetryQueue([]);
    setNeedsReconnect(false);
    certIdsRef.current = new Map();
  };

  const handleReconnect = () => {
    // Clear the stale account so the sidebar shows the Google connect button.
    setConnectedGoogleAccount(null);
    resetEmailProgress();
    setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
    setRetryQueue([]);
    setNeedsReconnect(false);
  };

  const handleDownloadErrorReport = () => {
    downloadErrorReport(emailProgress.errors, 'email');
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const formatTime = (date: Date | null): string => {
    if (!date) return '--:--:--';
    return date.toLocaleTimeString();
  };

  // Live ETA from actual throughput. A 1s interval (declared above) forces a
  // re-render while sending so the ETA ticks even between throttled progress
  // writes. "calculating…" until enough data (>=3 sent) to avoid wild early
  // estimates during the burst phase.
  const elapsedMs = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
  const completedNow = emailProgress.current;
  let etaLabel = 'calculating…';
  if (completedNow >= 3 && elapsedMs > 500) {
    const rate = completedNow / (elapsedMs / 1000);
    if (rate > 0) {
      const remaining = Math.max(0, emailProgress.total - completedNow);
      const etaMs = (remaining / rate) * 1000;
      etaLabel = `~${formatDuration(etaMs)} left · ${rate.toFixed(1)}/s`;
    }
  }

  if (emailProgress.status === 'idle') {
    return (
      <button
        onClick={handleSend}
        disabled={!isReady}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25"
      >
        <Send className="w-5 h-5" />
        <span>Send to {csvData.length} Recipients</span>
      </button>
    );
  }

  if (emailProgress.status === 'sending' || emailProgress.status === 'paused') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              Sending {emailProgress.current}/{emailProgress.total}
            </span>
            <span className="text-slate-500 truncate max-w-[150px]">
              {emailProgress.currentRecipient}
            </span>
          </div>
          <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full transition-all rounded-full ${
                emailProgress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
              }`}
              style={{
                width: `${emailProgress.total > 0 ? (emailProgress.current / emailProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{emailProgress.sent.length} sent</span>
            {emailProgress.errors.length > 0 && (
              <span className="text-red-500">{emailProgress.errors.length} failed</span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handlePauseResume}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {localPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            <span>{localPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button
            onClick={handleStop}
            className="flex items-center justify-center px-3 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {emailProgress.status === 'sending' && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{etaLabel}</span>
          </div>
        )}
      </div>
    );
  }

  if (emailProgress.status === 'completed') {
    const hasErrors = emailProgress.errors.length > 0;

    return (
      <div className="space-y-4">
        {needsReconnect && (
          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-800">Google session expired</p>
                <p className="text-sm text-orange-600 mt-0.5">
                  Reconnect your Google account, then retry the failed emails.
                </p>
              </div>
            </div>
            <button
              onClick={handleReconnect}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reconnect Google Account
            </button>
          </div>
        )}

        <div
          className={`p-3 rounded-lg ${
            hasErrors ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {hasErrors ? (
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className={`font-medium ${hasErrors ? 'text-amber-800' : 'text-emerald-800'}`}>
                {hasErrors ? 'Completed with issues' : 'All emails sent!'}
              </p>
              <p className={`text-sm ${hasErrors ? 'text-amber-600' : 'text-emerald-600'}`}>
                {emailProgress.sent.length} of {csvData.length} emails sent
              </p>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <Clock className="w-3.5 h-3.5" />
            <span>First sent: {formatTime(logs.firstSent)}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <Clock className="w-3.5 h-3.5" />
            <span>Last sent: {formatTime(logs.lastSent)}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <Clock className="w-3.5 h-3.5" />
            <span>Total time: {formatDuration(logs.totalElapsed)}</span>
          </div>
        </div>

        {hasErrors && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
            <p className="text-sm font-medium text-red-800">
              {emailProgress.errors.length} email{emailProgress.errors.length > 1 ? 's' : ''} failed
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRetry}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Failed
              </button>
              <button
                onClick={handleDownloadErrorReport}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Report
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleDone}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-medium hover:bg-slate-900 transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          Done
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleSend}
      disabled={!isReady}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25"
    >
      <Send className="w-5 h-5" />
      <span>Send to {csvData.length} Recipients</span>
    </button>
  );
}
