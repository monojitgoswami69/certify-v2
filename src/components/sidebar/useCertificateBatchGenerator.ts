'use client';

import { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { useAppStore } from '../../store/useAppStore';
import {
  downloadBlob,
  delay,
  downloadErrorReport,
  sanitizeFilename,
} from '../../lib/utils';
import { generateCertificate } from '../../lib/certificate-engine';
import { ensureFontsLoaded } from '../../lib/font-loader';
import { ensureCertificateIds, buildVerifyUrlFor } from '../../lib/cert-registration';
import type { CsvRow, CertificateGenerationRecord, ExportFormats } from '../../types';

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
    exportFormats,
    setExportFormats,
    setError,
  } = useAppStore();

  const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
  const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
  const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
  const [generationRecords, setGenerationRecords] = useState<CertificateGenerationRecord[]>([]);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const [localPaused, setLocalPaused] = useState(false);

  // rowIndex -> verification id, survives "Retry Failed"
  const certIdsRef = useRef<Map<number, string>>(new Map());

  // Accumulated successful certificates across initial run and retries
  const successfulCertsRef = useRef<Map<number, GeneratedCertItem>>(new Map());

  const validBoxes = boxes.filter((b) => b.field);
  const isReady = Boolean(templateImage && csvData.length > 0 && validBoxes.length > 0);

  const getFilenameBasis = useCallback(
    (row: CsvRow) => {
      for (const box of boxes) {
        if (box.field && row[box.field]?.trim()) {
          return row[box.field].trim();
        }
      }
      return 'Certificate';
    },
    [boxes]
  );

  const buildZipAndDownload = useCallback(
    async (certs: GeneratedCertItem[], formats: ExportFormats) => {
      if (certs.length === 0) return null;

      const zip = new JSZip();
      const pngFolder = formats.png ? zip.folder('png') : null;
      const jpgFolder = formats.jpg ? zip.folder('jpg') : null;
      const pdfFolder = formats.pdf ? zip.folder('pdf') : null;

      for (const cert of certs) {
        if (formats.png && cert.pngBlob && pngFolder) {
          pngFolder.file(`${cert.filename}.png`, cert.pngBlob);
        }
        if (formats.jpg && cert.jpgBlob && jpgFolder) {
          jpgFolder.file(`${cert.filename}.jpg`, cert.jpgBlob);
        }
        if (formats.pdf && cert.pdfBlob && pdfFolder) {
          pdfFolder.file(`${cert.filename}.pdf`, cert.pdfBlob);
        }
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      setZipBlob(blob);

      const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
      const zipFilename = `certificates_${safeEvent}${new Date().toISOString().split('T')[0]}.zip`;
      downloadBlob(blob, zipFilename);

      return blob;
    },
    [eventName]
  );

  const generateBatch = useCallback(
    async (records: Array<{ rowIndex: number; row: CsvRow }>, isRetry: boolean = false) => {
      if (!templateImage || records.length === 0) return;

      const activeFormatsList = [
        exportFormats.png && 'PNG',
        exportFormats.jpg && 'JPG',
        exportFormats.pdf && 'PDF',
      ].filter(Boolean) as string[];

      if (activeFormatsList.length === 0) {
        setError('Please select at least one format (PNG, JPG, or PDF) to export.');
        return;
      }

      abortRef.current = false;
      pauseRef.current = false;
      setLocalPaused(false);
      setError(null);

      const startTime = Date.now();
      const errors: FailedRecord[] = [];

      if (!isRetry) {
        successfulCertsRef.current = new Map();
        setZipBlob(null);

        // Initialize full generation records for audit tracking
        const initialRecords: CertificateGenerationRecord[] = records.map(({ rowIndex, row }) => {
          const name = getFilenameBasis(row);
          return {
            rowIndex,
            name,
            filename: `${sanitizeFilename(name)}_${rowIndex}`,
            status: 'pending',
            formats: activeFormatsList,
          };
        });
        setGenerationRecords(initialRecords);
      } else {
        // Mark retrying records as pending
        setGenerationRecords((prev) =>
          prev.map((r) =>
            records.some((rec) => rec.rowIndex === r.rowIndex)
              ? { ...r, status: 'pending', error: undefined }
              : r
          )
        );
      }

      setProgress({
        current: 0,
        total: records.length,
        currentName: 'Loading fonts...',
        status: 'loading-fonts',
        errors: [],
        generated: successfulCertsRef.current.size,
      });

      const uniqueFonts = new Set(boxes.map((b) => b.fontFamily).filter(Boolean));
      await ensureFontsLoaded(uniqueFonts);

      setProgress({
        current: 0,
        total: records.length,
        currentName: '',
        status: 'generating',
        errors: [],
        generated: successfulCertsRef.current.size,
      });

      if (!isRetry) {
        setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
      }

      // Pre-register verification IDs for any records that haven't been registered yet
      const useQr = qrZones.length > 0;
      if (useQr) {
        try {
          setProgress((prev) => ({
            ...prev,
            status: 'loading-fonts',
            currentName: 'Registering certificates...',
          }));
          certIdsRef.current = await ensureCertificateIds({
            records,
            existingIds: certIdsRef.current,
            getDisplayName: getFilenameBasis,
            getEmail: (row) => (emailColumn ? (row[emailColumn] || '').trim() : ''),
            templateName: templateFile?.name || 'template',
            eventName: eventName || 'General Event',
          });
          setProgress((prev) => ({ ...prev, status: 'generating', currentName: '' }));
        } catch (err) {
          setError(
            `QR registration failed: ${err instanceof Error ? err.message : 'unknown error'}. ` +
              'Batch aborted — no certificates were generated with unverifiable QR codes.'
          );
          setProgress(DEFAULT_PROGRESS);
          return;
        }
      }

      for (let i = 0; i < records.length; i++) {
        if (abortRef.current) {
          setProgress((prev) => ({ ...prev, status: 'idle' }));
          return;
        }

        while (pauseRef.current) {
          await delay(100);
          if (abortRef.current) {
            setProgress((prev) => ({ ...prev, status: 'idle' }));
            return;
          }
        }

        const { rowIndex, row } = records[i];
        const filenameBasis = getFilenameBasis(row);
        const filename = `${sanitizeFilename(filenameBasis)}_${rowIndex}`;

        setProgress((prev) => ({
          ...prev,
          current: i + 1,
          currentName: filenameBasis,
        }));

        setGenerationRecords((prev) =>
          prev.map((r) => (r.rowIndex === rowIndex ? { ...r, status: 'generating' } : r))
        );

        try {
          const certId = certIdsRef.current.get(rowIndex);
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

          const certItem: GeneratedCertItem = {
            rowIndex,
            filename,
            pngBlob: cert.pngBlob,
            jpgBlob: cert.jpgBlob,
            pdfBlob: cert.pdfBlob,
          };

          successfulCertsRef.current.set(rowIndex, certItem);

          setGenerationRecords((prev) =>
            prev.map((r) =>
              r.rowIndex === rowIndex
                ? {
                    ...r,
                    status: 'generated',
                    certId,
                    verificationUrl,
                    timestamp: new Date().toLocaleTimeString(),
                  }
                : r
            )
          );

          setProgress((prev) => ({
            ...prev,
            generated: prev.generated + 1,
          }));

          setLogs((prev) => ({
            ...prev,
            lastGenerated: new Date(),
          }));
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Generation failed';
          errors.push({
            rowIndex,
            name: filenameBasis,
            row,
            error: errorMsg,
          });

          setGenerationRecords((prev) =>
            prev.map((r) =>
              r.rowIndex === rowIndex
                ? {
                    ...r,
                    status: 'failed',
                    error: errorMsg,
                    timestamp: new Date().toLocaleTimeString(),
                  }
                : r
            )
          );
        }

        await delay(10);
      }

      // Create ZIP archive combining all successful certificates
      const allSuccessfulCerts = Array.from(successfulCertsRef.current.values());
      if (allSuccessfulCerts.length > 0) {
        setProgress((prev) => ({
          ...prev,
          status: 'zipping',
          currentName: 'Building ZIP archive...',
        }));

        await buildZipAndDownload(allSuccessfulCerts, exportFormats);
      }

      const totalElapsed = Date.now() - startTime;
      setLogs((prev) => ({ ...prev, totalElapsed }));

      setProgress({
        current: records.length,
        total: records.length,
        currentName: '',
        status: 'completed',
        errors,
        generated: allSuccessfulCerts.length,
      });

      setRetryQueue(errors);
    },
    [
      templateImage,
      templateFile,
      boxes,
      validBoxes,
      qrZones,
      eventName,
      emailColumn,
      exportFormats,
      setError,
      getFilenameBasis,
      buildZipAndDownload,
    ]
  );

  const handleGenerate = useCallback(async () => {
    const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
    await generateBatch(records, false);
  }, [csvData, generateBatch]);

  const handleRetry = useCallback(async () => {
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
  };

  const handleDone = () => {
    setProgress(DEFAULT_PROGRESS);
    setLogs(DEFAULT_LOGS);
    setRetryQueue([]);
    certIdsRef.current = new Map();
  };

  const handleDownloadErrorReport = () => {
    downloadErrorReport(progress.errors, 'generation');
  };

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
  };
}
