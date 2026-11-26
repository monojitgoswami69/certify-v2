'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { EmailDeliveryBlockedError, EmailRateLimitError, EmailUnconfirmedError, IssuanceAccessRequiredError, saveEventMailPreferences, sendEmailV2 } from '../../lib/api-client';
import {
  replaceTemplateVariables,
  delay,
  downloadErrorReport,
  downloadFullDeliveryReport,
  sanitizeFilename,
  validateEmailAddress,
} from '../../lib/utils';
import { generateCertificate } from '../../lib/certificate-engine';
import { ensureFontsLoaded, loadFontsForWorker } from '../../lib/font-loader';
import {
  createPooledRenderer,
  templateImageToBlob,
  type PooledCertificateRenderer,
} from '../../lib/render-service';
import { CertificateWorkerPool } from '../../lib/worker-pool';
import { buildVerifyUrlFor } from '../../lib/verification-links';
import { selectRecipientName } from '../../lib/batch-review';
import type { CsvRow, EmailProgress, EmailDeliveryRecord, EmailDeliveryStatus } from '../../types';

export interface FailedRecord {
  rowIndex: number;
  name: string;
  email: string;
  row: CsvRow;
  error: string;
}

export interface EmailLogs {
  firstSent: Date | null;
  lastSent: Date | null;
  totalElapsed: number;
}

function excludesAutomaticRetry(status?: EmailDeliveryStatus) {
  return status === 'sent' || status === 'unconfirmed' || status === 'in_flight' || status === 'skipped';
}

export function useEmailBatchRunner() {
  const {
    templateImage,
    templateFile,
    csvData,
    csvReview,
    boxes,
    images,
    emailColumn,
    emailSettings,
    emailProgress,
    qrZones,
    setEmailProgress,
    resetEmailProgress,
    setError,
    connectedGoogleAccount,
    setConnectedGoogleAccount,
    eventName,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    isBatchRegistered,
    registrationDirty,
  } = useAppStore();

  const user = useAuthStore((state) => state.user);

  const [logs, setLogs] = useState<EmailLogs>({ firstSent: null, lastSent: null, totalElapsed: 0 });
  const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [networkAlert, setNetworkAlert] = useState<string | null>(null);

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const isMounted = useRef(false);
  const reconnectRef = useRef(false);
  // Synchronous busy flag: the Send button's disabled state commits a render
  // late, and a second click would double-send the whole batch.
  const sendInFlightRef = useRef(false);
  const [localPaused, setLocalPaused] = useState(false);
  const startTimeRef = useRef<number>(0);
  const [, setEtaTick] = useState(0);

  // Consecutive network error counter for circuit breaker
  const consecutiveNetworkErrorsRef = useRef(0);

  // Comprehensive tracking map: rowIndex -> EmailDeliveryRecord
  const deliveryRosterRef = useRef(csvData);
  const deliveryRecordsRef = useRef<Map<number, EmailDeliveryRecord>>(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      abortRef.current = true;
      if (sendInFlightRef.current) resetEmailProgress();
    };
  }, [resetEmailProgress]);

  useEffect(() => {
    if (emailProgress.status !== 'sending') return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [emailProgress.status]);

  const hasMailingAccount = Boolean(user && connectedGoogleAccount?.email === user.email);
  const validBoxes = boxes.filter((b) => b.field || b.kind === 'static');
  const attachImage = Boolean(emailSettings.attachJpg || emailSettings.attachPng);
  const useQr = qrZones.length > 0;
  const isReady = Boolean(
    templateImage &&
      csvData.length > 0 &&
      validBoxes.length > 0 &&
      emailColumn &&
      hasMailingAccount &&
      (emailSettings.attachPdf || attachImage) &&
      isBatchRegistered && !registrationDirty
  );

  const getDisplayName = useCallback((row: CsvRow) => selectRecipientName(row, boxes), [boxes]);

  const sendBatch = useCallback(
    async (records: Array<{ rowIndex: number; row: CsvRow }>, isRetry: boolean = false) => {
      if (sendInFlightRef.current) return;
      if (!templateImage || validBoxes.length === 0) return;

      // Read registration at call time: registering does not re-create this callback
      const { isBatchRegistered, registeredCertIds, verificationOrigin, registrationDirty, registrationEventId } = useAppStore.getState();
      if (!registrationEventId || !isBatchRegistered || registrationDirty) {
        setError('Issue the batch before sending emails.');
        return;
      }

      if (deliveryRosterRef.current !== csvData) {
        deliveryRosterRef.current = csvData;
        deliveryRecordsRef.current.clear();
      }
      sendInFlightRef.current = true;
      abortRef.current = false;
      pauseRef.current = false;
      setLocalPaused(false);
      setError(null);
      setNetworkAlert(null);
      consecutiveNetworkErrorsRef.current = 0;

      // Declared outside the try so the finally clause can terminate the pool.
      let renderer: PooledCertificateRenderer | null = null;
      let terminateRenderer: (() => void) | null = null;

      try {
      await saveEventMailPreferences(registrationEventId, emailSettings);
      if (abortRef.current) return;
      const startTime = Date.now();
      startTimeRef.current = startTime;
      const errors: FailedRecord[] = [];
      const sent: Array<{ rowIndex: number; name: string; email: string; sentAt?: string }> = [];
      let completedCount = 0;
      let firstSentAt: Date | null = null;
      let lastSentAt: Date | null = null;

      // Populate or preserve delivery tracking records
      records.forEach(({ rowIndex, row }) => {
        const existing = deliveryRecordsRef.current.get(rowIndex);
        if (!existing || (!isRetry && !excludesAutomaticRetry(existing.status))) {
          deliveryRecordsRef.current.set(rowIndex, {
            rowIndex,
            name: getDisplayName(row),
            email: (row[emailColumn] || '').trim(),
            status: 'pending',
          });
        }
      });

      setEmailProgress({
        current: 0,
        total: records.length,
        currentRecipient: 'Initializing pipeline...',
        status: 'sending',
        errors: [],
        sent: [],
        records: Array.from(deliveryRecordsRef.current.values()),
      });

      const uniqueFonts = new Set(boxes.map((b) => b.fontFamily).filter(Boolean));
      if (defaultFont) uniqueFonts.add(defaultFont);
      await ensureFontsLoaded(uniqueFonts);

      if (!isRetry) {
        setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
      }

      reconnectRef.current = false;
      setNeedsReconnect(false);

      // Worker-pool rendering for attachments: renders run off the main
      // thread (chunk-ahead, overlapping with network-bound sends), so a
      // 2000-email batch no longer freezes the UI between sends. Falls back
      // to main-thread rendering when workers are unavailable.
      const isAlreadyProcessed = (rowIndex: number) => {
        const status = deliveryRecordsRef.current.get(rowIndex)?.status;
        return excludesAutomaticRetry(status);
      };

      if (CertificateWorkerPool.isSupported()) {
        try {
          const templateBlob = await templateImageToBlob(templateImage, templateFile);
          if (templateBlob) {
            const workerFonts = await loadFontsForWorker(uniqueFonts);
            const renderTasks = records
              .filter(({ rowIndex, row }) => !isAlreadyProcessed(rowIndex)
                && validateEmailAddress((row[emailColumn] || '').trim()).valid
                && registeredCertIds.has(rowIndex))
              .map(({ rowIndex, row }) => {
                const certId = registeredCertIds.get(rowIndex);
                return {
                  id: rowIndex,
                  rowIndex,
                  row,
                  filename: sanitizeFilename(getDisplayName(row)),
                  verificationUrl: useQr && certId ? buildVerifyUrlFor(certId, verificationOrigin) : undefined,
                };
              });
            const pooled = await createPooledRenderer({
              templateBlob,
              templateWidth: templateImage.naturalWidth || templateImage.width,
              templateHeight: templateImage.naturalHeight || templateImage.height,
              boxes: validBoxes,
              qrZones: useQr ? qrZones : [],
              images,
              formats: [
                ...(emailSettings.attachJpg ? ['jpg'] : []),
                ...(emailSettings.attachPng ? ['png'] : []),
                ...(emailSettings.attachPdf ? ['pdf'] : []),
              ] as Array<'png' | 'jpg' | 'pdf'>,
              fonts: workerFonts,
              tasks: renderTasks,
            });
            if (pooled) {
              renderer = pooled.renderer;
              terminateRenderer = pooled.terminate;
            }
          }
        } catch (err) {
          console.warn('[Email Batch] pooled rendering unavailable, using main thread:', err);
        }
      }

      if (!isMounted.current) return;

      setEmailProgress({
        current: 0,
        total: records.length,
        currentRecipient: 'Preparing dispatch...',
        status: 'sending',
        errors: [],
        sent: [],
        records: Array.from(deliveryRecordsRef.current.values()),
      });

      const concurrency = Math.min(10, records.length);
      let recordIndex = 0;

      let lastProgressAt = 0;
      const PROGRESS_INTERVAL_MS = 250;
      const flushProgress = (displayName: string, force: boolean = false) => {
        const now = Date.now();
        if (!isMounted.current || (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS)) return;
        lastProgressAt = now;
        setEmailProgress({
          current: completedCount,
          currentRecipient: displayName,
          errors: errors as unknown as EmailProgress['errors'],
          sent,
          records: Array.from(deliveryRecordsRef.current.values()),
        });
      };

      let nextSendAt = 0;
      const providerLimit = { error: null as EmailRateLimitError | null };
      const sendWithRateLimit = async (params: Parameters<typeof sendEmailV2>[0]) => {
        while (!abortRef.current && !reconnectRef.current) {
          if (providerLimit.error) throw providerLimit.error;
          const remaining = nextSendAt - Date.now();
          if (pauseRef.current || remaining > 0) {
            await delay(pauseRef.current ? 100 : Math.min(remaining, 250));
            continue;
          }
          try {
            return await sendEmailV2(params);
          } catch (error) {
            if (!(error instanceof EmailRateLimitError)) throw error;
            if (error.source === 'gmail') {
              providerLimit.error = error;
              throw error;
            }
            nextSendAt = Math.max(nextSendAt, Date.now() + error.retryAfter * 1000);
          }
        }
        return null;
      };

      const worker = async () => {
        let workerCanvas: HTMLCanvasElement | undefined;

        while (recordIndex < records.length && !abortRef.current && !reconnectRef.current && !providerLimit.error) {
          while (pauseRef.current && !abortRef.current && !reconnectRef.current) {
            await delay(100);
          }

          if (abortRef.current || reconnectRef.current) return;

          const currentIndex = recordIndex++;
          if (currentIndex >= records.length) return;

          const record = records[currentIndex];
          const { rowIndex, row } = record;
          const displayName = getDisplayName(row);
          const rawEmail = (row[emailColumn] || '').trim();

          if (isAlreadyProcessed(rowIndex)) {
            completedCount++;
            continue;
          }

          deliveryRecordsRef.current.set(rowIndex, {
            rowIndex,
            name: displayName,
            email: rawEmail,
            status: 'sending',
          });

          const validation = validateEmailAddress(rawEmail);
          if (!validation.valid) {
            const failReason = validation.warning || 'Invalid email address syntax';
            if (rawEmail) errors.push({
              rowIndex,
              name: displayName || '(empty)',
              email: rawEmail || '(empty)',
              row,
              error: failReason,
            });
            deliveryRecordsRef.current.set(rowIndex, {
              rowIndex,
              name: displayName || '(empty)',
              email: rawEmail || '(empty)',
              status: rawEmail ? 'failed' : 'skipped',
              timestamp: new Date().toISOString(),
              error: failReason,
            });
            completedCount++;
            flushProgress(displayName || '(skipped)');
            continue;
          }

          const email = validation.email;

          try {
            const certId = registeredCertIds.get(rowIndex);
            if (!certId) {
              throw new Error('No registered certificate ID for this row. Re-register the batch.');
            }

            let cert: { filename: string; jpgBlob?: Blob; pngBlob?: Blob; pdfBlob?: Blob };
            if (renderer) {
              const rendered = await renderer.render({
                id: rowIndex,
                rowIndex,
                row,
                filename: sanitizeFilename(displayName),
                verificationUrl: useQr && certId ? buildVerifyUrlFor(certId, verificationOrigin) : undefined,
              });
              if (rendered.error || !rendered.blobs) {
                throw new Error(rendered.error || 'Certificate rendering failed');
              }
              cert = {
                filename: rendered.filename,
                jpgBlob: rendered.blobs.jpg,
                pngBlob: rendered.blobs.png,
                pdfBlob: rendered.blobs.pdf,
              };
            } else {
              if (!workerCanvas) workerCanvas = document.createElement('canvas');
              cert = await generateCertificate({
                templateImage,
                boxes: validBoxes,
                row,
                filename: sanitizeFilename(displayName),
                includeJpg: Boolean(emailSettings.attachJpg),
                includePng: Boolean(emailSettings.attachPng),
                includePdf: Boolean(emailSettings.attachPdf),
                canvas: workerCanvas,
                qrZones: useQr ? qrZones : undefined,
                images,
                verificationUrl: useQr && certId ? buildVerifyUrlFor(certId, verificationOrigin) : undefined,
              });
            }

            const subject = replaceTemplateVariables(emailSettings.subject, row);
            const bodyPlain = replaceTemplateVariables(emailSettings.bodyPlain, row);
            const bodyHtml = emailSettings.bodyHtml.trim()
              ? replaceTemplateVariables(emailSettings.bodyHtml, row, { html: true })
              : '';

            const result = await sendWithRateLimit({
              certificateId: certId,
              recipientEmail: email,
              emailSubject: subject,
              emailBodyPlain: bodyPlain,
              emailBodyHtml: bodyHtml,
              filename: cert.filename,
              jpgBlob: cert.jpgBlob,
              pngBlob: cert.pngBlob,
              pdfBlob: cert.pdfBlob,
            });

            if (!result) return;

            if (result.status === 'reconnect_required') {
              reconnectRef.current = true;
              setNeedsReconnect(true);
              const failReason = result.message;
              errors.push({
                rowIndex,
                name: displayName,
                email,
                row,
                error: failReason,
              });
              deliveryRecordsRef.current.set(rowIndex, {
                rowIndex,
                name: displayName,
                email,
                status: 'failed',
                timestamp: new Date().toISOString(),
                error: failReason,
              });
              completedCount++;
              flushProgress(displayName, true);
              return;
            }

            consecutiveNetworkErrorsRef.current = 0;
            const nowIso = new Date().toISOString();
            sent.push({ rowIndex, name: displayName, email, sentAt: nowIso });
            deliveryRecordsRef.current.set(rowIndex, {
              rowIndex,
              name: displayName,
              email,
              status: 'sent',
              timestamp: nowIso,
            });
            completedCount++;

            if (!firstSentAt) firstSentAt = new Date();
            lastSentAt = new Date();

            flushProgress(displayName);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to send';
            if (err instanceof IssuanceAccessRequiredError) {
              abortRef.current = true;
              setError(errorMsg);
            }

            const blocked = err instanceof EmailDeliveryBlockedError ? err.deliveryStatus : null;
            if (blocked === 'accepted') {
              const nowIso = new Date().toISOString();
              sent.push({ rowIndex, name: displayName, email, sentAt: nowIso });
              deliveryRecordsRef.current.set(rowIndex, {
                rowIndex,
                name: displayName,
                email,
                status: 'sent',
                timestamp: nowIso,
              });
              completedCount++;
              flushProgress(displayName);
              continue;
            }
            const unconfirmed = err instanceof EmailUnconfirmedError || blocked === 'unknown';
            const isNetDrop = err instanceof EmailUnconfirmedError && err.networkFailure;

            if (isNetDrop) {
              consecutiveNetworkErrorsRef.current++;
              if (consecutiveNetworkErrorsRef.current >= 5) {
                pauseRef.current = true;
                setLocalPaused(true);
                setNetworkAlert(
                  'Network connection interrupted: 5 consecutive email requests failed. The batch was auto-paused to protect your quota. Click Resume once online.'
                );
              }
            } else {
              consecutiveNetworkErrorsRef.current = 0;
            }

            errors.push({ rowIndex, name: displayName, email, row, error: errorMsg });
            deliveryRecordsRef.current.set(rowIndex, {
              rowIndex,
              name: displayName,
              email,
              status: unconfirmed ? 'unconfirmed' : blocked === 'sending' ? 'in_flight' : 'failed',
              timestamp: new Date().toISOString(),
              error: errorMsg,
            });
            completedCount++;
            flushProgress(displayName);
          }
        }
      };

      const workers = Array.from({ length: concurrency }, async (_, idx) => {
        await delay(idx * 40);
        return worker();
      });
      await Promise.all(workers);

      if (!isMounted.current) return;

      for (const [rIndex, r] of deliveryRecordsRef.current.entries()) {
        if (r.status === 'sending') {
          deliveryRecordsRef.current.set(rIndex, { ...r, status: 'pending' });
        }
      }

      const allRecords = Array.from(deliveryRecordsRef.current.values());

      setEmailProgress({
        current: completedCount,
        total: records.length,
        currentRecipient: '',
        status: abortRef.current ? (completedCount > 0 ? 'completed' : 'idle') : 'completed',
        errors: errors as unknown as EmailProgress['errors'],
        sent,
        records: allRecords,
      });

      setLogs({
        firstSent: firstSentAt,
        lastSent: lastSentAt,
        totalElapsed: Date.now() - startTime,
      });

      if (providerLimit.error) setError(providerLimit.error.message);
      setRetryQueue(errors.filter(({ rowIndex }) => deliveryRecordsRef.current.get(rowIndex)?.status === 'failed'));

      } catch (error) {
        if (isMounted.current) {
          setError(error instanceof Error ? error.message : 'Could not start certificate delivery.');
          resetEmailProgress();
        }
      } finally {
        terminateRenderer?.();
        sendInFlightRef.current = false;
      }
    },
    [
      csvData,
      images,
      useQr,
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
      eventName,
      defaultFont,
      defaultFontSize,
      defaultFontColor,
    ]
  );

  const handleSend = useCallback(async () => {
    const { csvReview: latestReview } = useAppStore.getState();
    const records = csvData.map((row, i) => ({ rowIndex: latestReview.numbers[i] ?? i + 1, row }));
    await sendBatch(records, false);
  }, [csvData, sendBatch]);

  const handleRetry = useCallback(async () => {
    if (deliveryRosterRef.current !== csvData) return;
    const records = retryQueue.map((err) => ({ rowIndex: err.rowIndex, row: err.row }));
    await sendBatch(records, true);
  }, [csvData, retryQueue, sendBatch]);

  // Delivery records span every run in this session, so rows sent by an earlier run or a retry are never re-sent
  const isRowSent = (rowIndex: number) => {
    const status = deliveryRosterRef.current === csvData ? deliveryRecordsRef.current.get(rowIndex)?.status : undefined;
    return excludesAutomaticRetry(status);
  };

  const handleResumeUnsent = useCallback(async () => {
    const { csvReview: latestReview } = useAppStore.getState();
    const unsentRecords = csvData
      .map((row, i) => ({ rowIndex: latestReview.numbers[i] ?? i + 1, row }))
      .filter(({ rowIndex }) => {
        if (deliveryRosterRef.current !== csvData) return true;
        const status = deliveryRecordsRef.current.get(rowIndex)?.status;
        return !excludesAutomaticRetry(status);
      });
    if (unsentRecords.length > 0) {
      await sendBatch(unsentRecords, false);
    }
  }, [csvData, sendBatch]);

  const handlePauseResume = () => {
    pauseRef.current = !pauseRef.current;
    setLocalPaused(pauseRef.current);
    setNetworkAlert(null);
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
    deliveryRecordsRef.current = new Map();
  };

  const handleReconnect = () => {
    setConnectedGoogleAccount(null);
    resetEmailProgress();
    setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
    setRetryQueue([]);
    setNeedsReconnect(false);
  };

  const handleDownloadFullReport = () => {
    const records =
      emailProgress.records && emailProgress.records.length > 0
        ? emailProgress.records
        : Array.from(deliveryRecordsRef.current.values());
    downloadFullDeliveryReport(records, eventName);
  };

  const handleDownloadErrorReport = () => {
    downloadErrorReport(emailProgress.errors, 'email');
  };

  const allTrackedRecords =
    emailProgress.records && emailProgress.records.length > 0
      ? emailProgress.records
      : Array.from(deliveryRecordsRef.current.values());

  const unsentCount = csvReview.numbers.reduce((count, number) => (isRowSent(number) ? count : count + 1), 0);

  return {
    emailProgress,
    csvData,
    logs,
    retryQueue,
    needsReconnect,
    networkAlert,
    localPaused,
    startTimeRef,
    isReady,
    allTrackedRecords,
    unsentCount,
    isDeliveryModalOpen,
    setIsDeliveryModalOpen,
    eventName,
    handleSend,
    handleRetry,
    handleResumeUnsent,
    handlePauseResume,
    handleStop,
    handleDone,
    handleReconnect,
    handleDownloadFullReport,
    handleDownloadErrorReport,
  };
}
