'use client';

import { useState, useMemo } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  Search,
  RefreshCw,
  Mail,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import type { EmailDeliveryRecord, EmailDeliveryStatus } from '../../types';
import { downloadFullDeliveryReport, downloadErrorReport } from '../../lib/utils';

interface EmailDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: EmailDeliveryRecord[];
  eventName?: string;
  onRetryFailed?: () => void;
  isSending?: boolean;
}

export function EmailDeliveryModal({
  isOpen,
  onClose,
  records,
  eventName,
  onRetryFailed,
  isSending = false,
}: EmailDeliveryModalProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EmailDeliveryStatus>('all');

  const stats = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let pending = 0;
    let sending = 0;
    let skipped = 0;

    for (const r of records) {
      if (r.status === 'sent') sent++;
      else if (r.status === 'failed') failed++;
      else if (r.status === 'sending') sending++;
      else if (r.status === 'skipped') skipped++;
      else pending++;
    }

    return {
      total: records.length,
      sent,
      failed,
      pending: pending + sending,
      sending,
      skipped,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) {
        if (statusFilter === 'pending' && (r.status === 'pending' || r.status === 'sending')) {
          // match pending tab
        } else {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.error && r.error.toLowerCase().includes(q)) ||
        r.rowIndex.toString().includes(q)
      );
    });
  }, [records, search, statusFilter]);

  if (!isOpen) return null;

  const handleDownloadFull = () => {
    downloadFullDeliveryReport(records, eventName);
  };

  const handleDownloadFailed = () => {
    const failedRecords = records
      .filter((r) => r.status === 'failed')
      .map((r) => ({
        rowIndex: r.rowIndex,
        name: r.name,
        email: r.email,
        error: r.error || 'Failed to deliver',
      }));
    downloadErrorReport(failedRecords, 'email');
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 animate-in fade-in duration-200">
      <div
        className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600 shadow-sm">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Mailing Delivery Log & Audit
                </h2>
                {eventName && (
                  <span className="hidden sm:inline-block px-2.5 py-0.5 text-xs font-semibold text-primary-700 bg-primary-50 rounded-full border border-primary-200">
                    {eventName}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Live audit trail of dispatched, failed, and pending certificate emails
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metrics Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:px-6 bg-slate-50 border-b border-slate-200">
          <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              Total Target
            </span>
            <span className="text-2xl font-bold text-slate-800 font-mono">{stats.total}</span>
          </div>

          <div className="p-3 bg-white border border-emerald-200 rounded-xl shadow-xs">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Delivered
            </span>
            <span className="text-2xl font-bold text-emerald-700 font-mono">{stats.sent}</span>
          </div>

          <div className="p-3 bg-white border border-red-200 rounded-xl shadow-xs">
            <span className="text-xs font-semibold text-red-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Failed / Not Sent
            </span>
            <span className="text-2xl font-bold text-red-700 font-mono">{stats.failed}</span>
          </div>

          <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Pending / In-Flight
            </span>
            <span className="text-2xl font-bold text-slate-600 font-mono">{stats.pending}</span>
          </div>
        </div>

        {/* Search, Filter Tabs & Export Actions Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipient, email, error..."
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({stats.total})
              </button>
              <button
                onClick={() => setStatusFilter('sent')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  statusFilter === 'sent'
                    ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-emerald-600'
                }`}
              >
                Sent ({stats.sent})
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  statusFilter === 'failed'
                    ? 'bg-white text-red-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-red-600'
                }`}
              >
                Failed ({stats.failed})
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  statusFilter === 'pending'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pending ({stats.pending})
              </button>
            </div>
          </div>

          {/* Export and Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadFull}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shadow-xs"
              title="Download full CSV report of all records"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
              <span>Export Full Report</span>
            </button>

            {stats.failed > 0 && (
              <button
                onClick={handleDownloadFailed}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors shadow-xs"
                title="Download CSV of failed records only"
              >
                <Download className="w-3.5 h-3.5 text-red-600" />
                <span>Export Failed Only</span>
              </button>
            )}

            {stats.failed > 0 && onRetryFailed && !isSending && (
              <button
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-xs"
                title="Retry sending failed records"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Failed</span>
              </button>
            )}
          </div>
        </div>

        {/* Records Table */}
        <div className="flex-1 overflow-auto">
          {filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
              <Mail className="w-10 h-10 mb-2 stroke-[1.5]" />
              <p className="text-sm font-medium text-slate-600">No records match the current filter</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Try searching for a different name, email, or resetting filters.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider z-10">
                <tr>
                  <th className="px-4 py-2.5 w-16">Row</th>
                  <th className="px-4 py-2.5">Recipient Name</th>
                  <th className="px-4 py-2.5">Email Address</th>
                  <th className="px-4 py-2.5 w-28">Status</th>
                  <th className="px-4 py-2.5 w-24">Time</th>
                  <th className="px-4 py-2.5">Diagnostics / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal">
                {filteredRecords.map((record) => {
                  let badge = null;
                  if (record.status === 'sent') {
                    badge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Sent
                      </span>
                    );
                  } else if (record.status === 'failed') {
                    badge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                        Failed
                      </span>
                    );
                  } else if (record.status === 'sending') {
                    badge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        Sending
                      </span>
                    );
                  } else if (record.status === 'skipped') {
                    badge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        Skipped
                      </span>
                    );
                  } else {
                    badge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Pending
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={record.rowIndex}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        record.status === 'failed' ? 'bg-red-50/20' : ''
                      }`}
                    >
                      <td className="px-4 py-2 font-mono text-slate-400">{record.rowIndex}</td>
                      <td className="px-4 py-2 font-semibold text-slate-800 break-words">
                        {record.name}
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700 break-all">
                        {record.email || <span className="text-slate-400 italic">none</span>}
                      </td>
                      <td className="px-4 py-2">{badge}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-[11px]">
                        {formatTime(record.timestamp)}
                      </td>
                      <td className="px-4 py-2">
                        {record.status === 'sent' ? (
                          <span className="text-emerald-600 font-medium">Delivered successfully</span>
                        ) : record.error ? (
                          <span className="text-red-600 font-medium break-words" title={record.error}>
                            {record.error}
                          </span>
                        ) : record.status === 'sending' ? (
                          <span className="text-blue-600">Connecting to Gmail...</span>
                        ) : (
                          <span className="text-slate-400 italic">Waiting in queue</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
          <span>
            Showing {filteredRecords.length} of {records.length} records
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Close Log
          </button>
        </div>
      </div>
    </div>
  );
}
