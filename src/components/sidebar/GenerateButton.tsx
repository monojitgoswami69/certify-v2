'use client';

import {
  Download,
  Mail,
  Loader2,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  FileSpreadsheet,
  Cpu,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useCertificateBatchGenerator } from './useCertificateBatchGenerator';
import { CertificateGenerationModal } from '../modals/CertificateGenerationModal';

export function GenerateButton() {
  const { csvData, setViewMode, eventName } = useAppStore();

  const {
    progress,
    logs,
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
  } = useCertificateBatchGenerator();

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

  const hasAnyFormat = exportFormats.png || exportFormats.jpg || exportFormats.pdf;

  return (
    <>
      {progress.status === 'idle' && (
        <div className="space-y-4">
          {/* Format Selection Switches (PNG, JPG, PDF) */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Export Formats
              </label>
              <span className="text-[11px] font-medium text-slate-500">
                Included in ZIP archive
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              {/* PNG Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={exportFormats.png}
                onClick={() => setExportFormats({ png: !exportFormats.png })}
                className="flex items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                    exportFormats.png ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                      exportFormats.png ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                  PNG
                </span>
              </button>

              {/* JPG Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={exportFormats.jpg}
                onClick={() => setExportFormats({ jpg: !exportFormats.jpg })}
                className="flex items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                    exportFormats.jpg ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                      exportFormats.jpg ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                  JPG
                </span>
              </button>

              {/* PDF Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={exportFormats.pdf}
                onClick={() => setExportFormats({ pdf: !exportFormats.pdf })}
                className="flex items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                    exportFormats.pdf ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                      exportFormats.pdf ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                  PDF
                </span>
              </button>
            </div>

            {!hasAnyFormat && (
              <p className="text-xs text-amber-600 font-medium">
                Please select at least one format (PNG, JPG, or PDF)
              </p>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!isReady || !hasAnyFormat}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25 cursor-pointer"
          >
            <Download className="w-5 h-5" />
            <span>Generate {csvData.length} Certificates (ZIP)</span>
          </button>

          <button
            onClick={() => setViewMode('email')}
            disabled={!isReady}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <Mail className="w-4 h-4 text-primary-600" />
            <span>Send via Email</span>
          </button>

          {generationRecords.length > 0 && (
            <button
              onClick={() => setIsReportOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>View Previous Generation Report ({generationRecords.length})</span>
            </button>
          )}
        </div>
      )}

      {(progress.status === 'generating' ||
        progress.status === 'paused' ||
        progress.status === 'loading-fonts' ||
        progress.status === 'zipping') && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 font-medium">
                {progress.status === 'loading-fonts'
                  ? 'Loading WebFonts...'
                  : progress.status === 'zipping'
                  ? 'Building ZIP file...'
                  : `Generating ${progress.current}/${progress.total}`}
              </span>
              <span className="text-slate-500 truncate max-w-[150px] font-mono text-xs">
                {progress.currentName}
              </span>
            </div>
            <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full transition-all rounded-full ${
                  progress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
                }`}
                style={{
                  width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="text-emerald-600 font-medium">{progress.generated} generated</span>
              {progress.errors.length > 0 && (
                <span className="text-red-600 font-medium">{progress.errors.length} failed</span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handlePauseResume}
              disabled={progress.status === 'zipping' || progress.status === 'loading-fonts'}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {localPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              <span>{localPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              onClick={handleStop}
              disabled={progress.status === 'zipping'}
              className="flex items-center justify-center px-3 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer"
              title="Stop generation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setIsReportOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>View Live Generation Audit ({generationRecords.length})</span>
          </button>

          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 font-medium">
            {progress.workerCount ? (
              <>
                <Cpu className="w-3.5 h-3.5 text-primary-600 animate-pulse" />
                <span>Running across {progress.workerCount} parallel workers</span>
              </>
            ) : (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" />
                <span>Processing certificates in background...</span>
              </>
            )}
          </div>
        </div>
      )}

      {progress.status === 'completed' && (
        <div className="space-y-4">
          <div
            className={`p-3 rounded-lg ${
              progress.errors.length > 0
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-emerald-50 border border-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2">
              {progress.errors.length > 0 ? (
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p
                  className={`font-medium ${
                    progress.errors.length > 0 ? 'text-amber-800' : 'text-emerald-800'
                  }`}
                >
                  {progress.errors.length > 0
                    ? 'Generation completed with issues'
                    : 'All certificates generated!'}
                </p>
                <p
                  className={`text-sm ${
                    progress.errors.length > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {progress.generated} of {progress.total} certificates generated into ZIP
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
            <div className="flex items-center gap-2 text-slate-600">
              <Clock className="w-3.5 h-3.5" />
              <span>First generated: {formatTime(logs.firstGenerated)}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Clock className="w-3.5 h-3.5" />
              <span>Last generated: {formatTime(logs.lastGenerated)}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <Clock className="w-3.5 h-3.5" />
              <span>Total time: {formatDuration(logs.totalElapsed)}</span>
            </div>
          </div>

          {/* Audit Report Button */}
          <button
            onClick={() => setIsReportOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Open Generation Audit Report ({generationRecords.length})</span>
          </button>

          {progress.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <p className="text-sm font-medium text-red-800">
                {progress.errors.length} certificate{progress.errors.length > 1 ? 's' : ''} failed
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRetry}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry Failed
                </button>
                <button
                  onClick={handleDownloadErrorReport}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 rounded-md text-sm font-medium hover:bg-red-100 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
            </div>
          )}

          <button
            onClick={handleDone}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-medium hover:bg-slate-900 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Done
          </button>
        </div>
      )}

      {/* Generation Audit Modal */}
      <CertificateGenerationModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        records={generationRecords}
        eventName={eventName}
        onRetryFailed={progress.errors.length > 0 ? handleRetry : undefined}
        isGenerating={progress.status === 'generating'}
        zipBlob={zipBlob}
        exportFormats={exportFormats}
      />
    </>
  );
}
