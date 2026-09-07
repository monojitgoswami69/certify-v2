'use client';

import {
  Send,
  Pause,
  Play,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
} from 'lucide-react';
import { useEmailBatchRunner } from './useEmailBatchRunner';
import { EmailDeliveryModal } from '../modals/EmailDeliveryModal';

export function EmailSendButton() {
  const {
    emailProgress,
    csvData,
    logs,
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
  } = useEmailBatchRunner();

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

  return (
    <>
      {emailProgress.status === 'idle' && (
        <div className="space-y-2">
          <button
            onClick={handleSend}
            disabled={!isReady}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25 cursor-pointer"
          >
            <Send className="w-5 h-5" />
            <span>Send to {csvData.length} Recipients</span>
          </button>

          {allTrackedRecords.length > 0 && (
            <button
              onClick={() => setIsDeliveryModalOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
              <span>View Last Delivery Log ({allTrackedRecords.length} records)</span>
            </button>
          )}
        </div>
      )}

      {(emailProgress.status === 'sending' || emailProgress.status === 'paused') && (
        <div className="space-y-4">
          {networkAlert && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p>{networkAlert}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 font-medium">
                Sending {emailProgress.current}/{emailProgress.total}
              </span>
              <span className="text-slate-500 truncate max-w-[150px] font-mono text-xs">
                {emailProgress.currentRecipient}
              </span>
            </div>
            <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full transition-all rounded-full ${
                  emailProgress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
                }`}
                style={{
                  width: `${
                    emailProgress.total > 0
                      ? (emailProgress.current / emailProgress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="text-emerald-600 font-medium">
                {emailProgress.sent.length} sent
              </span>
              {emailProgress.errors.length > 0 && (
                <span className="text-red-600 font-medium">
                  {emailProgress.errors.length} failed
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handlePauseResume}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              {localPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              <span>{localPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              onClick={handleStop}
              className="flex items-center justify-center px-3 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
              title="Stop dispatch"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setIsDeliveryModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            <span>Open Live Audit Log</span>
          </button>

          {emailProgress.status === 'sending' && (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
              <span>{etaLabel}</span>
            </div>
          )}
        </div>
      )}

      {emailProgress.status === 'completed' && (
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
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Reconnect Google Account
              </button>
            </div>
          )}

          <div
            className={`p-3 rounded-lg ${
              emailProgress.errors.length > 0
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-emerald-50 border border-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2">
              {emailProgress.errors.length > 0 ? (
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p
                  className={`font-medium ${
                    emailProgress.errors.length > 0 ? 'text-amber-800' : 'text-emerald-800'
                  }`}
                >
                  {emailProgress.errors.length > 0
                    ? 'Completed with issues'
                    : 'All emails sent successfully!'}
                </p>
                <p
                  className={`text-sm ${
                    emailProgress.errors.length > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {emailProgress.sent.length} of {csvData.length} emails delivered
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

          {/* Audit Log & Report Buttons */}
          <div className="space-y-2">
            <button
              onClick={() => setIsDeliveryModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-primary-600" />
              <span>View Full Delivery Log & Audit</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownloadFullReport}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                title="Download full CSV report of all records"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export Full CSV</span>
              </button>

              {emailProgress.errors.length > 0 ? (
                <button
                  onClick={handleDownloadErrorReport}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
                  title="Download CSV of failed records only"
                >
                  <Download className="w-3.5 h-3.5 text-red-600" />
                  <span>Export Failed CSV</span>
                </button>
              ) : (
                <div className="flex items-center justify-center text-[11px] text-emerald-600 font-medium">
                  0 Failures
                </div>
              )}
            </div>
          </div>

          {/* Retry Failed and/or Resume Unsent Options */}
          {emailProgress.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <p className="text-xs font-semibold text-red-800">
                {emailProgress.errors.length} email
                {emailProgress.errors.length > 1 ? 's' : ''} failed delivery
              </p>
              <button
                onClick={handleRetry}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-md text-xs font-semibold hover:bg-red-700 transition-colors shadow-xs cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Failed Only ({emailProgress.errors.length})</span>
              </button>
            </div>
          )}

          {unsentCount > 0 && emailProgress.errors.length === 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <p className="text-xs font-semibold text-amber-800">
                Batch stopped with {unsentCount} unsent record{unsentCount > 1 ? 's' : ''}
              </p>
              <button
                onClick={handleResumeUnsent}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-md text-xs font-semibold hover:bg-amber-700 transition-colors shadow-xs cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume Remaining ({unsentCount})</span>
              </button>
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

      {/* Interactive Delivery Audit Modal */}
      <EmailDeliveryModal
        isOpen={isDeliveryModalOpen}
        onClose={() => setIsDeliveryModalOpen(false)}
        records={allTrackedRecords}
        eventName={eventName}
        onRetryFailed={emailProgress.errors.length > 0 ? handleRetry : undefined}
        isSending={emailProgress.status === 'sending'}
      />
    </>
  );
}
