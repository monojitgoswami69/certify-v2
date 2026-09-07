'use client';

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  Search,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  Archive,
  ExternalLink,
} from 'lucide-react';
import type { CertificateGenerationRecord, CertificateGenerationStatus, ExportFormats } from '../../types';
import { downloadFullGenerationReport, downloadErrorReport, downloadBlob, sanitizeFilename } from '../../lib/utils';

interface CertificateGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: CertificateGenerationRecord[];
  eventName?: string;
  onRetryFailed?: () => void;
  isGenerating?: boolean;
  zipBlob?: Blob | null;
  exportFormats?: ExportFormats;
}

export function CertificateGenerationModal({
  isOpen,
  onClose,
  records,
  eventName,
  onRetryFailed,
  isGenerating = false,
  zipBlob = null,
  exportFormats,
}: CertificateGenerationModalProps) {
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CertificateGenerationStatus>('all');

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeFormatsText = useMemo(() => {
    const list: string[] = [];
    if (exportFormats?.png) list.push('PNG');
    if (exportFormats?.jpg) list.push('JPG');
    if (exportFormats?.pdf) list.push('PDF');
    return list.length > 0 ? list.join(', ') : '—';
  }, [exportFormats]);

  const stats = useMemo(() => {
    let generated = 0;
    let failed = 0;
    let pending = 0;
    let generating = 0;

    for (const r of records) {
      if (r.status === 'generated') generated++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'generating') generating++;
      else pending++;
    }

    return {
      total: records.length,
      generated,
      failed,
      pending: pending + generating,
      generating,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) {
        if (statusFilter === 'pending' && (r.status === 'pending' || r.status === 'generating')) {
          // match pending tab
        } else {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.filename.toLowerCase().includes(q) ||
        (r.certId && r.certId.toLowerCase().includes(q)) ||
        (r.error && r.error.toLowerCase().includes(q)) ||
        r.rowIndex.toString().includes(q)
      );
    });
  }, [records, search, statusFilter]);

  if (!isOpen || !mounted) return null;

  const handleDownloadFull = () => {
    downloadFullGenerationReport(records, eventName);
  };

  const handleDownloadFailed = () => {
    const failedRecords = records
      .filter((r) => r.status === 'failed')
      .map((r) => ({
        rowIndex: r.rowIndex,
        name: r.name,
        error: r.error || 'Failed to generate',
      }));
    downloadErrorReport(failedRecords, 'generation');
  };

  const handleDownloadZip = () => {
    if (!zipBlob) return;
    const safeEvent = eventName ? `${sanitizeFilename(eventName)}_` : '';
    const dateStr = new Date().toISOString().split('T')[0];
    downloadBlob(zipBlob, `certificates_${safeEvent}${dateStr}.zip`);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600 font-bold">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Certificate Generation Report</h2>
              <p className="text-xs text-slate-500">
                {eventName ? `Event: ${eventName}` : 'Direct Certificate Batch Generation'} ·{' '}
                {records.length} total recipients
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white border-b border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
            <div className="text-xs font-semibold text-slate-500 mb-1">Total Certificates</div>
            <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
          </div>
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200/60">
            <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Generated
            </div>
            <div className="text-2xl font-bold text-emerald-700">{stats.generated}</div>
          </div>
          <div className="p-3 bg-red-50 rounded-xl border border-red-200/60">
            <div className="text-xs font-semibold text-red-700 flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
              Failed
            </div>
            <div className="text-2xl font-bold text-red-700">{stats.failed}</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-xl border border-blue-200/60">
            <div className="text-xs font-semibold text-blue-700 flex items-center gap-1.5 mb-1">
              <Archive className="w-3.5 h-3.5 text-blue-600" />
              Active Formats
            </div>
            <div
              className="text-2xl font-bold text-blue-700 tracking-tight truncate"
              title={activeFormatsText}
            >
              {activeFormatsText}
            </div>
          </div>
        </div>

        {/* Search and Tabs */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/30">
          <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => setStatusFilter('generated')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                statusFilter === 'generated'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Generated ({stats.generated})
            </button>
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                statusFilter === 'failed'
                  ? 'bg-white text-red-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Failed ({stats.failed})
            </button>
            {stats.pending > 0 && (
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  statusFilter === 'pending'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                In Progress / Pending ({stats.pending})
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipient, ID, error..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400"
            />
          </div>
        </div>

        {/* Generation Records Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No records match your filter criteria.</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3 w-12 text-center">#</th>
                    <th className="py-2.5 px-3">Recipient & Filename</th>
                    <th className="py-2.5 px-3">Formats</th>
                    <th className="py-2.5 px-3">Certificate ID</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Diagnostics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredRecords.map((r) => (
                    <tr
                      key={r.rowIndex}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        r.status === 'failed' ? 'bg-red-50/30' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono">
                        {r.rowIndex}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-800">{r.name || 'Anonymous'}</div>
                        <div className="text-[11px] text-slate-500 font-mono truncate max-w-[200px]">
                          {r.filename}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {r.formats.map((fmt) => (
                            <span
                              key={fmt}
                              className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold border border-slate-200"
                            >
                              {fmt}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {r.verificationUrl ? (
                          <a
                            href={r.verificationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 hover:underline font-semibold"
                            title="Open verification page"
                          >
                            <span>{r.certId ? r.certId.slice(0, 8) : ''}...</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : r.certId ? (
                          <span
                            className="text-slate-500 font-mono text-[11px]"
                            title={`Static Certificate ID: ${r.certId}`}
                          >
                            {r.certId.slice(0, 8)}... (Static)
                          </span>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {r.status === 'generated' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Generated
                          </span>
                        )}
                        {r.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
                            <AlertCircle className="w-3 h-3 text-red-600" />
                            Failed
                          </span>
                        )}
                        {r.status === 'generating' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
                            <RefreshCw className="w-3 h-3 text-blue-600 animate-spin" />
                            Generating
                          </span>
                        )}
                        {r.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            <Clock className="w-3 h-3 text-slate-400" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                        {r.timestamp || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        {r.error ? (
                          <span className="text-red-600 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[220px]" title={r.error}>
                              {r.error}
                            </span>
                          </span>
                        ) : r.status === 'generated' ? (
                          <span className="text-slate-500">Ready in ZIP</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadFull}
              disabled={records.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              title="Download full CSV report of all certificate rows"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Download Full CSV Report
            </button>
            {stats.failed > 0 && (
              <button
                onClick={handleDownloadFailed}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-sm"
                title="Download CSV report of failed certificates only"
              >
                <Download className="w-4 h-4 text-red-600" />
                Download Failed Only
              </button>
            )}
            {zipBlob && (
              <button
                onClick={handleDownloadZip}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-sm"
                title="Download the generated ZIP archive"
              >
                <Download className="w-4 h-4 text-indigo-600" />
                Download ZIP
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {stats.failed > 0 && onRetryFailed && (
              <button
                onClick={onRetryFailed}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                Retry Failed ({stats.failed})
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
