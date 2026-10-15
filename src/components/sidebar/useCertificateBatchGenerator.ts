'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { downloadZip } from 'client-zip';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import {
  downloadBlob,
  downloadErrorReport,
  sanitizeFilename,
  hasFileSystemAccess,
  streamToFile,
  resolveFieldValue,
} from '../../lib/utils';
import { generateCertificate } from '../../lib/certificate-engine';
import { ensureFontsLoaded, loadFontsForWorker, type WorkerFontData } from '../../lib/font-loader';
import { buildVerifyUrlFor } from '../../lib/cert-registration';
import { autoSaveCurrentTemplate } from '../../lib/template-autosave';
import {
  CertificateWorkerPool,
  type OutputFormat,
  type WorkerTask,
} from '../../lib/worker-pool';
import { createRafScheduler } from '../../lib/raf-scheduler';
import type { CsvRow, CertificateGenerationRecord, ExportFormats } from '../../types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FailedRecord {
  rowIndex: number;
  name: string;
  row: CsvRow;
  error: string;
}

export interface GenerateLogs {
  firstGenerated: Date | null;
  lastGenerated: Date | null;
  totalElapsed: number;
}

export interface GenerateProgress {
  current: number;
  total: number;
  currentName: string;
  status: 'idle' | 'generating' | 'paused' | 'completed' | 'zipping' | 'loading-fonts';
  errors: FailedRecord[];
  generated: number;
  workerCount?: number;
  speed?: string;
}

interface GeneratedCertItem {
  rowIndex: number;
  filename: string;
  pngBlob?: Blob;
  jpgBlob?: Blob;
  pdfBlob?: Blob;
}

const DEFAULT_PROGRESS: GenerateProgress = {
  current: 0,
  total: 0,
  currentName: '',
  status: 'idle',
  errors: [],
  generated: 0,
  speed: undefined,
};

const DEFAULT_LOGS: GenerateLogs = {
  firstGenerated: null,
  lastGenerated: null,
  totalElapsed: 0,
};

export function useCertificateBatchGenerator() {
  const {
    templateImage,
    templateFile,
    csvData,
    boxes,
    qrZones,
    eventName,
    emailColumn,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    exportFormats,
    setExportFormats,
    setError,
    isBatchRegistered,
  } = useAppStore();

  const { token } = useAuthStore();

  const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
  const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
  const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
  const [generationRecords, setGenerationRecords] = useState<CertificateGenerationRecord[]>([]);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const [localPaused, setLocalPaused] = useState(false);
  const workerPoolRef = useRef<CertificateWorkerPool | null>(null);

  // Accumulated successful certificates across initial run and retries
  const successfulCertsRef = useRef<Map<number, GeneratedCertItem>>(new Map());

  // Failure tracking during generation (for error logs and final report assembly)
  const failedMapRef = useRef<Map<number, { error: string; timestamp: string }>>(new Map());
  const errorsRef = useRef<FailedRecord[]>([]);

  const validBoxes = boxes.filter((b) => b.field);
  const useQr = qrZones.length > 0;
  const isReady = Boolean(
    templateImage &&
      csvData.length > 0 &&
      validBoxes.length > 0 &&
      (!useQr || isBatchRegistered)
  );

  // Clean up workers on unmount
  useEffect(() => {
    return () => {
      if (workerPoolRef.current) {
        workerPoolRef.current.terminate();
        workerPoolRef.current = null;
      }
    };
  }, []);

  const getFilenameBasis = useCallback(
    (row: CsvRow) => {
      for (const box of boxes) {
        const val = resolveFieldValue(box.field, row);
        if (val.trim()) {
          return val.trim();
        }
      }
      return 'Certificate';
    },
    [boxes]
  );

  /**
   * Package certificates into a streaming ZIP archive using client-zip.
   * Direct disk streaming via File System Access API avoids in-memory heap spikes.
   */
  const buildZipAndDownload = useCallback(
    async (certs: GeneratedCertItem[], formats: ExportFormats) => {
      if (certs.length === 0) return null;

      const zipFiles: Array<{ name: string; lastModified: Date; input: Blob }> = [];
      const timestamp = new Date();

      for (const cert of certs) {
        if (formats.png && cert.pngBlob) {
          zipFiles.push({
            name: `png/${cert.filename}.png`,
            lastModified: timestamp,
            input: cert.pngBlob,
          });
        }
        if (formats.jpg && cert.jpgBlob) {
          zipFiles.push({
            name: `jpg/${cert.filename}.jpg`,
            lastModified: timestamp,
            input: cert.jpgBlob,
          });
        }
        if (formats.pdf && cert.pdfBlob) {
          zipFiles.push({
            name: `pdf/${cert.filename}.pdf`,
            lastModified: timestamp,
            input: cert.pdfBlob,
          });
        }
      }

      const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
      const zipFilename = `certificates_${safeEvent}${new Date().toISOString().split('T')[0]}.zip`;

      let finalBlob: Blob | null = null;

      if (hasFileSystemAccess()) {
        try {
          const zipResponse = downloadZip(zipFiles);
          if (zipResponse.body) {
            const streamed = await streamToFile(zipResponse.body, zipFilename);
            if (!streamed) {
              finalBlob = await downloadZip(zipFiles).blob();
            }
          } else {
            finalBlob = await downloadZip(zipFiles).blob();
            downloadBlob(finalBlob, zipFilename);
          }
        } catch (err) {
          console.warn('[FSA stream fallback to blob]:', err);
          finalBlob = await downloadZip(zipFiles).blob();
          downloadBlob(finalBlob, zipFilename);
        }
      } else {
        finalBlob = await downloadZip(zipFiles).blob();
        downloadBlob(finalBlob, zipFilename);
      }

      if (finalBlob) {
        setZipBlob(finalBlob);
      }
      return finalBlob;
    },
    [eventName]
  );

  const generateBatch = useCallback(
    async (records: Array<{ rowIndex: number; row: CsvRow }>, isRetry: boolean = false) => {
      if (!templateImage || records.length === 0) return;

      const activeFormatsList = [
        exportFormats.png && 'png',
        exportFormats.jpg && 'jpg',
        exportFormats.pdf && 'pdf',
      ].filter(Boolean) as OutputFormat[];

      if (activeFormatsList.length === 0) {
        setError('Please select at least one format (PNG, JPG, or PDF) to export.');
        return;
      }

      // Read registration at call time: registering does not re-create this callback
      const { isBatchRegistered, registeredCertIds, registrationDirty } = useAppStore.getState();
      if (useQr && (!isBatchRegistered || registrationDirty)) {
        setError('Batch is not registered or has changed since registration. Please register certificates to activate QR verification before generating.');
        return;
      }

      abortRef.current = false;
      pauseRef.current = false;
      setLocalPaused(false);
      setError(null);
      setIsReportOpen(false);

      const startTime = Date.now();

      const activeFormatsDisplay = [
        exportFormats.png && 'PNG',
        exportFormats.jpg && 'JPG',
        exportFormats.pdf && 'PDF',
      ].filter(Boolean) as string[];

      if (!isRetry) {
        successfulCertsRef.current = new Map();
        failedMapRef.current = new Map();
        errorsRef.current = [];
        setZipBlob(null);
        setGenerationRecords([]);
      } else {
        // Clear previous failure entries for the records being retried
        for (const { rowIndex } of records) {
          failedMapRef.current.delete(rowIndex);
        }
        errorsRef.current = errorsRef.current.filter(
          (e) => !records.some((r) => r.rowIndex === e.rowIndex)
        );
      }

      // Step 1: Preload web fonts for both DOM and Web Workers
      setProgress({
        current: 0,
        total: records.length,
        currentName: 'Loading fonts...',
        status: 'loading-fonts',
        errors: [],
        generated: successfulCertsRef.current.size,
      });

      const uniqueFonts = new Set(boxes.map((b) => b.fontFamily).filter(Boolean));
      if (defaultFont) uniqueFonts.add(defaultFont);

      let workerFonts: WorkerFontData[] = [];
      try {
        const [loadedWorkerFonts] = await Promise.all([
          loadFontsForWorker(uniqueFonts),
          ensureFontsLoaded(uniqueFonts),
        ]);
        workerFonts = loadedWorkerFonts;
      } catch (fontErr) {
        console.warn('[Batch Generator] Font preloading error:', fontErr);
      }

      if (!isRetry) {
        setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
      }

      // Step 2: Prepare tasks for worker pool. With QR enabled, a row without a registered
      // ID must fail loudly instead of silently producing a certificate with a blank QR.
      const tasks: WorkerTask[] = [];
      records.forEach(({ rowIndex, row }, i) => {
        const name = getFilenameBasis(row);
        const certId = registeredCertIds.get(rowIndex);
        if (useQr && !certId) {
          const errorMsg = 'No registered certificate ID for this row. Re-register the batch.';
          failedMapRef.current.set(rowIndex, { error: errorMsg, timestamp: new Date().toLocaleTimeString() });
          errorsRef.current.push({ rowIndex, name, row, error: errorMsg });
          return;
        }
        tasks.push({
          id: i,
          rowIndex,
          row,
          filename: `${sanitizeFilename(name)}_${rowIndex}`,
          verificationUrl: useQr && certId ? buildVerifyUrlFor(certId) : undefined,
        });
      });

      // Scheduler for lightweight progress UI updates (counters + failure logs)
      const progressScheduler = createRafScheduler<GenerateProgress>(setProgress);

      let pureGenDurationMs = 0;
      let workerExecutionSucceeded = false;

      // Step 4: Multi-Threaded Generation via Worker Pool (core - 1)
      if (CertificateWorkerPool.isSupported()) {
        const pool = new CertificateWorkerPool();
        workerPoolRef.current = pool;

        try {
          // Obtain template Blob reference (zero-copy transfer across workers)
          let templateBlob: Blob | null = templateFile;
          if (!templateBlob && templateImage) {
            const canvas = document.createElement('canvas');
            canvas.width = templateImage.naturalWidth || templateImage.width;
            canvas.height = templateImage.naturalHeight || templateImage.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(templateImage, 0, 0);
            templateBlob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
          }

          if (!templateBlob) throw new Error('Template graphic data is missing');

          const workerCount = await pool.initialize(
            templateBlob,
            templateImage.naturalWidth || templateImage.width,
            templateImage.naturalHeight || templateImage.height,
            validBoxes,
            qrZones,
            activeFormatsList,
            workerFonts
          );

          progressScheduler.schedule({
            current: 0,
            total: records.length,
            currentName: `Generating with ${workerCount} parallel workers...`,
            status: 'generating',
            errors: [],
            generated: successfulCertsRef.current.size,
            workerCount,
          });
          const genStartTime = performance.now();

          let totalCompleted = 0;
          const SUB_BATCH_SIZE = Math.max(workerCount * 2, 8);

          for (let chunkIdx = 0; chunkIdx < tasks.length; chunkIdx += SUB_BATCH_SIZE) {
            if (abortRef.current) break;

            while (pauseRef.current && !abortRef.current) {
              await delay(100);
            }

            if (abortRef.current) break;

            const currentSubTasks = tasks.slice(chunkIdx, chunkIdx + SUB_BATCH_SIZE);
            await pool.processChunk(currentSubTasks, (result) => {
              if (abortRef.current) return;
              totalCompleted++;

              if (result.blobs && !result.error) {
                // Store successful blob in memory - do NOT stream success log records to React state
                successfulCertsRef.current.set(result.rowIndex, {
                  rowIndex: result.rowIndex,
                  filename: result.filename,
                  pngBlob: result.blobs.png,
                  jpgBlob: result.blobs.jpg,
                  pdfBlob: result.blobs.pdf,
                });
              } else if (result.error) {
                // Only track and stream failure logs
                const errorMsg = result.error || 'Generation failed';
                const rowObj = records.find((r) => r.rowIndex === result.rowIndex)?.row || {};
                const timestamp = new Date().toLocaleTimeString();

                failedMapRef.current.set(result.rowIndex, {
                  error: errorMsg,
                  timestamp,
                });

                errorsRef.current.push({
                  rowIndex: result.rowIndex,
                  name: result.filename,
                  row: rowObj,
                  error: errorMsg,
                });
              }

              const elapsedSec = (performance.now() - genStartTime) / 1000;
              const speed = elapsedSec > 0.2 ? (totalCompleted / elapsedSec).toFixed(1) : undefined;

              // Stream failure logs, live generation speed, and lightweight counters; no success log records
              progressScheduler.schedule({
                current: totalCompleted,
                total: records.length,
                currentName: result.filename,
                status: pauseRef.current ? 'paused' : 'generating',
                errors: [...errorsRef.current],
                generated: successfulCertsRef.current.size,
                workerCount,
                speed,
              });
            });
          }

          pureGenDurationMs = performance.now() - genStartTime;
          workerExecutionSucceeded = true;
        } catch (poolErr) {
          console.warn('[Worker Pool Warning, seamlessly falling back to main thread]:', poolErr);
        } finally {
          pool.terminate();
          workerPoolRef.current = null;
        }
      }

      if (!workerExecutionSucceeded) {
        // Fallback to main-thread rendering if Web Workers / OffscreenCanvas are unsupported or failed
        const pendingRowIndexes = new Set(tasks.map((t) => t.rowIndex));
        const remainingRecords = records.filter(
          (rec) => pendingRowIndexes.has(rec.rowIndex) && !successfulCertsRef.current.has(rec.rowIndex)
        );
        for (const rec of remainingRecords) {
          // A crashed worker may have recorded these rows as failed; the fallback gets a clean retry
          if (failedMapRef.current.delete(rec.rowIndex)) {
            errorsRef.current = errorsRef.current.filter((e) => e.rowIndex !== rec.rowIndex);
          }
        }
        const fallbackStartTime = performance.now();
        for (let i = 0; i < remainingRecords.length; i++) {
          if (abortRef.current) break;

          while (pauseRef.current && !abortRef.current) {
            await delay(100);
          }

          if (abortRef.current) break;

          const { rowIndex, row } = remainingRecords[i];
          const filenameBasis = getFilenameBasis(row);
          const filename = `${sanitizeFilename(filenameBasis)}_${rowIndex}`;

          try {
            const certId = registeredCertIds.get(rowIndex);
            const verificationUrl = useQr && certId ? buildVerifyUrlFor(certId) : undefined;

            const cert = await generateCertificate({
              templateImage,
              boxes: validBoxes,
              row,
              filename,
              includePng: exportFormats.png,
              includeJpg: exportFormats.jpg,
              includePdf: exportFormats.pdf,
              qrZones: useQr ? qrZones : undefined,
              verificationUrl,
            });

            successfulCertsRef.current.set(rowIndex, {
              rowIndex,
              filename,
              pngBlob: cert.pngBlob,
              jpgBlob: cert.jpgBlob,
              pdfBlob: cert.pdfBlob,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Generation failed';
            const timestamp = new Date().toLocaleTimeString();

            failedMapRef.current.set(rowIndex, {
              error: errorMsg,
              timestamp,
            });

            errorsRef.current.push({
              rowIndex,
              name: filenameBasis,
              row,
              error: errorMsg,
            });
          }

          const elapsedSec = (performance.now() - fallbackStartTime) / 1000;
          const speed = elapsedSec > 0.2 ? ((i + 1) / elapsedSec).toFixed(1) : undefined;

          progressScheduler.schedule({
            current: successfulCertsRef.current.size + errorsRef.current.length,
            total: records.length,
            currentName: filenameBasis,
            status: 'generating',
            errors: [...errorsRef.current],
            generated: successfulCertsRef.current.size,
            speed,
          });
        }
        pureGenDurationMs += performance.now() - fallbackStartTime;
      }

      progressScheduler.flush();

      // Step 5: Assemble the full report at the end of generation (all - failed = succeeded)
      const failedMap = failedMapRef.current;
      const completionTimestamp = new Date().toLocaleTimeString();

      const assembledRecords: CertificateGenerationRecord[] = records.map(({ rowIndex, row }) => {
        const name = getFilenameBasis(row);
        const filename = `${sanitizeFilename(name)}_${rowIndex}`;
        const failedInfo = failedMap.get(rowIndex);

        if (failedInfo) {
          return {
            rowIndex,
            name,
            filename,
            status: 'failed',
            error: failedInfo.error,
            timestamp: failedInfo.timestamp,
            formats: activeFormatsDisplay,
          };
        }

        if (successfulCertsRef.current.has(rowIndex)) {
          const certId = registeredCertIds.get(rowIndex);
          const verificationUrl = useQr && certId ? buildVerifyUrlFor(certId) : undefined;
          return {
            rowIndex,
            name,
            filename,
            status: 'generated',
            certId,
            verificationUrl,
            timestamp: completionTimestamp,
            formats: activeFormatsDisplay,
          };
        }

        return {
          rowIndex,
          name,
          filename,
          status: 'pending',
          formats: activeFormatsDisplay,
        };
      });

      if (isRetry) {
        setGenerationRecords((prev) => {
          const patchMap = new Map(assembledRecords.map((r) => [r.rowIndex, r]));
          return prev.map((old) => patchMap.get(old.rowIndex) || old);
        });
      } else {
        setGenerationRecords(assembledRecords);
      }

      // Step 6: Build ZIP Archive via client-zip
      const allSuccessfulCerts = Array.from(successfulCertsRef.current.values());
      if (allSuccessfulCerts.length > 0 && !abortRef.current) {
        setProgress((prev) => ({
          ...prev,
          status: 'zipping',
          currentName: 'Building ZIP archive...',
        }));

        await buildZipAndDownload(allSuccessfulCerts, exportFormats);
      }

      const totalElapsed = Date.now() - startTime;
      setLogs((prev) => ({ ...prev, totalElapsed, lastGenerated: new Date() }));

      const currentErrors = [...errorsRef.current];
      const pureGenSec = pureGenDurationMs / 1000;
      const finalSpeed =
        pureGenSec > 0.05 && allSuccessfulCerts.length > 0
          ? (allSuccessfulCerts.length / pureGenSec).toFixed(1)
          : undefined;

      setProgress({
        current: records.length,
        total: records.length,
        currentName: '',
        status: 'completed',
        errors: currentErrors,
        generated: allSuccessfulCerts.length,
        speed: finalSpeed,
      });

      setRetryQueue(currentErrors);

      // Step 7: Auto-save template & layout configuration
      if (allSuccessfulCerts.length > 0 && !abortRef.current) {
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
      qrZones,
      eventName,
      emailColumn,
      defaultFont,
      defaultFontSize,
      defaultFontColor,
      token,
      exportFormats,
      setError,
      getFilenameBasis,
      buildZipAndDownload,
    ]
  );

  const handleGenerate = useCallback(async () => {
    setIsReportOpen(false);
    const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
    await generateBatch(records, false);
  }, [csvData, generateBatch]);

  const handleRetry = useCallback(async () => {
    setIsReportOpen(false);
    const records = retryQueue.map((err) => ({ rowIndex: err.rowIndex, row: err.row }));
    await generateBatch(records, true);
  }, [retryQueue, generateBatch]);

  const handlePauseResume = () => {
    pauseRef.current = !pauseRef.current;
    setLocalPaused(pauseRef.current);
    setProgress((prev) => ({
      ...prev,
      status: pauseRef.current ? 'paused' : 'generating',
    }));
  };

  const handleStop = () => {
    abortRef.current = true;
    pauseRef.current = false;
    setLocalPaused(false);
    setIsReportOpen(false);
    if (workerPoolRef.current) {
      workerPoolRef.current.terminate();
      workerPoolRef.current = null;
    }
  };

  const handleDone = () => {
    setProgress(DEFAULT_PROGRESS);
    setLogs(DEFAULT_LOGS);
    setRetryQueue([]);
    successfulCertsRef.current = new Map();
    failedMapRef.current = new Map();
    errorsRef.current = [];
    setZipBlob(null);
    setIsReportOpen(false);
  };

  const handleDownloadErrorReport = () => {
    downloadErrorReport(progress.errors, 'generation');
  };

  const handleDownloadZipArchive = useCallback(async () => {
    if (zipBlob) {
      const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
      const dateStr = new Date().toISOString().split('T')[0];
      downloadBlob(zipBlob, `certificates_${safeEvent}${dateStr}.zip`);
      return;
    }
    const allSuccessfulCerts = Array.from(successfulCertsRef.current.values());
    if (allSuccessfulCerts.length > 0) {
      await buildZipAndDownload(allSuccessfulCerts, exportFormats);
    }
  }, [zipBlob, eventName, buildZipAndDownload, exportFormats]);

  return {
    progress,
    logs,
    retryQueue,
    localPaused,
    isReady,
    generationRecords,
    zipBlob,
    isReportOpen,
    setIsReportOpen,
    exportFormats,
    setExportFormats,
    handleGenerate,
    handleRetry,
    handlePauseResume,
    handleStop,
    handleDone,
    handleDownloadErrorReport,
    handleDownloadZip: handleDownloadZipArchive,
    hasZipArchive: Boolean(zipBlob || successfulCertsRef.current.size > 0),
  };
}
