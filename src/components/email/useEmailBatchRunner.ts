'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { sendEmailV2 } from '../../lib/api-client';
import {
  replaceTemplateVariables,
  delay,
  downloadErrorReport,
  downloadFullDeliveryReport,
  sanitizeFilename,
  validateEmailAddress,
} from '../../lib/utils';
import { generateCertificate } from '../../lib/certificate-engine';
import { ensureFontsLoaded } from '../../lib/font-loader';
import { ensureCertificateIds, buildVerifyUrlFor } from '../../lib/cert-registration';
import { autoSaveCurrentTemplate } from '../../lib/template-autosave';
import type { CsvRow, EmailProgress, EmailDeliveryRecord } from '../../types';

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

export function useEmailBatchRunner() {
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
    connectedGoogleAccount,
    setConnectedGoogleAccount,
    eventName,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
  } = useAppStore();

  const { token } = useAuthStore();

  const [logs, setLogs] = useState<EmailLogs>({ firstSent: null, lastSent: null, totalElapsed: 0 });
  const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [networkAlert, setNetworkAlert] = useState<string | null>(null);

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const reconnectRef = useRef(false);
  const [localPaused, setLocalPaused] = useState(false);
  const startTimeRef = useRef<number>(0);
  const [, setEtaTick] = useState(0);

  // Consecutive network error counter for circuit breaker
  const consecutiveNetworkErrorsRef = useRef(0);

  // rowIndex -> verification id, survives "Retry Failed"
  const certIdsRef = useRef<Map<number, string>>(new Map());

  // Comprehensive tracking map: rowIndex -> EmailDeliveryRecord
  const deliveryRecordsRef = useRef<Map<number, EmailDeliveryRecord>>(new Map());

  useEffect(() => {
    if (emailProgress.status !== 'sending') return;
    const id = setInterval(() => setEtaTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [emailProgress.status]);

  const hasMailingAccount = Boolean(connectedGoogleAccount);
  const validBoxes = boxes.filter((b) => b.field);
  const attachImage = Boolean(emailSettings.attachJpg || emailSettings.attachPng);
  const isReady = Boolean(
    templateImage &&
      csvData.length > 0 &&
      validBoxes.length > 0 &&
      emailColumn &&
      hasMailingAccount &&
      (emailSettings.attachPdf || attachImage)
  );

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
      setNetworkAlert(null);
      consecutiveNetworkErrorsRef.current = 0;

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
        if (!existing || (!isRetry && existing.status !== 'sent')) {
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
      await ensureFontsLoaded(uniqueFonts);

      if (!isRetry) {
        setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
      }

      reconnectRef.current = false;
      setNeedsReconnect(false);

      // QR verification mode: register every pending row BEFORE rendering
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
            records: Array.from(deliveryRecordsRef.current.values()),
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

      const concurrency = Math.min(10, records.length);
      let recordIndex = 0;

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
          records: Array.from(deliveryRecordsRef.current.values()),
        });
      };

      const GMAIL_BURST_PER_SECOND = Number(process.env.NEXT_PUBLIC_GMAIL_BURST_PER_SECOND ?? 8);
      const GMAIL_QUOTA_PER_MINUTE = Number(process.env.NEXT_PUBLIC_GMAIL_QUOTA_PER_MINUTE ?? 145);
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
            await delay(Math.max(50, 60000 - (now - minuteWindow[0]) + 10));
            continue;
          }
          if (secondWindow.length >= GMAIL_BURST_PER_SECOND) {
            await delay(Math.max(50, 1000 - (now - secondWindow[0]) + 10));
            continue;
          }
          secondWindow.push(now);
          minuteWindow.push(now);
          return;
        }
      };

      const worker = async () => {
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
          const rawEmail = (row[emailColumn] || '').trim();

          // Failsafe: Avoid sending duplicate email if already marked sent in this session
          const existing = deliveryRecordsRef.current.get(rowIndex);
          if (existing && existing.status === 'sent' && !isRetry) {
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
            errors.push({
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
              status: 'failed',
              timestamp: new Date().toISOString(),
              error: failReason,
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
              reconnectRef.current = true;
              setNeedsReconnect(true);
              const failReason = 'Google session expired — reconnect required';
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

            const isNetDrop =
              errorMsg.toLowerCase().includes('fetch') ||
              errorMsg.toLowerCase().includes('network') ||
              errorMsg.toLowerCase().includes('offline') ||
              errorMsg.toLowerCase().includes('failed to load');

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
              status: 'failed',
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

      setRetryQueue(errors);

      // Auto-save template & layout configuration to database when emails are sent
      if (sent.length > 0) {
        autoSaveCurrentTemplate({
          templateImage,
          templateFile,
          eventName,
          boxes,
          qrZones,
          defaultFont,
          defaultFontSize,
          defaultFontColor,
          token,
        }).catch((err) => console.warn('[AutoSave Template Error]:', err));
      }
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
      eventName,
      defaultFont,
      defaultFontSize,
      defaultFontColor,
      token,
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

  const handleResumeUnsent = useCallback(async () => {
    const sentSet = new Set(emailProgress.sent.map((s) => s.rowIndex));
    const unsentRecords = csvData
      .map((row, i) => ({ rowIndex: i + 2, row }))
      .filter((r) => !sentSet.has(r.rowIndex));
    if (unsentRecords.length > 0) {
      await sendBatch(unsentRecords, false);
    }
  }, [csvData, emailProgress.sent, sendBatch]);

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
    certIdsRef.current = new Map();
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

  const unsentCount = Math.max(0, csvData.length - emailProgress.sent.length);

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
