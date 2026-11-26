'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Search,
  ChevronRight,
  ChevronLeft,
  Palette,
  KeyRound,
  AlertCircle,
  Copy,
  Download,
  Mail,
  ChevronDown,
  ChevronUp,
  CalendarDays,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { canManageAccess } from '../../lib/access-role';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { downloadBlob, sanitizeFilename, csvCell } from '../../lib/utils';
import { WeCertifyHeader } from '../../components/account/WeCertifyHeader';
import { IssuerWorkspace } from '../../components/account/IssuerWorkspace';
import { apiFetch, fetchEventDesign } from '../../lib/api-client';
import { emailIssuedCertificate, renderIssuedPdf } from '../../lib/issued-certificate';
import { EventRecipients } from './EventRecipients';
import { EventMailQueue, mailStatusLabels } from './EventMailQueue';
import type { DashboardEventSummary, DashboardParticipant } from '../api/dashboard/route';

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventIdParam = searchParams.get('eventId');
  const legacyEventName = searchParams.get('event');
  const selectedEventKey = eventIdParam || legacyEventName;
  const logout = useAuthStore((state) => state.logout);
  const canModerate = useAuthStore((state) => canManageAccess(state.user?.platformRole));
  const mainRef = useRef<HTMLElement>(null);

  // Events summary list state
  const [events, setEvents] = useState<DashboardEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search in Registered Events list
  const [eventSearchQuery, setEventSearchQuery] = useState('');

  // -------------------------------------------------------------
  // Detail selection comes from the event ID in the URL.
  // -------------------------------------------------------------
  const [detailedEventSummary, setDetailedEventSummary] = useState<DashboardEventSummary | null>(null);
  const selectedEventName = detailedEventSummary?.eventName ?? legacyEventName ?? '';
  const [participants, setParticipants] = useState<DashboardParticipant[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Search & Status filters within detailed participant view
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');
  const [participantStatusFilter, setParticipantStatusFilter] = useState<'all' | 'issued' | 'revoked'>('all');

  // Revoking state for row-level spinners
  const [updatingCertId, setUpdatingCertId] = useState<string | null>(null);

  const [eventSettingsSaving, setEventSettingsSaving] = useState(false);
  const [workingCertificate, setWorkingCertificate] = useState<string | null>(null);
  const [certificateNotice, setCertificateNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const validThroughDateInput = detailedEventSummary?.validThrough
    ? new Date(detailedEventSummary.validThrough).toLocaleDateString('sv-SE')
    : '';

  const handleUpdateEventSettings = useCallback(async (patch: { trackScans?: boolean; validThrough?: string | null }) => {
    const eventId = detailedEventSummary?.eventId;
    if (!eventId || eventSettingsSaving) return;
    setEventSettingsSaving(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Certify-Request': '1',
      };
      const res = await apiFetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed to update');
      const data = await res.json();
      setDetailedEventSummary((prev) =>
        prev && prev.eventId === data.event.id
          ? { ...prev, trackScans: data.event.trackScans, validThrough: data.event.validThrough }
          : prev
      );
      setEvents((prev) =>
        prev.map((e) => (e.eventId === data.event.id ? { ...e, trackScans: data.event.trackScans, validThrough: data.event.validThrough } : e))
      );
    } catch (err) {
      console.warn('[Dashboard] event settings update failed:', err);
    } finally {
      setEventSettingsSaving(false);
    }
  }, [detailedEventSummary, eventSettingsSaving]);


  // In-flight request deduplication and stable events ref
  const inFlightOverviewRef = useRef<boolean>(false);
  const inFlightDetailsRef = useRef<{ name: string; controller: AbortController } | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // 2. Fetch Events List (Fresh call on mount / reload)
  const fetchEventsList = useCallback(async () => {
    if (inFlightOverviewRef.current) return;
    inFlightOverviewRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/dashboard', {
        cache: 'no-store',
      });

      if (res.status === 401) {
        logout();
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to load registered events');
      }

      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      inFlightOverviewRef.current = false;
    }
  }, [logout, router]);

  useEffect(() => {
    if (!selectedEventKey) void fetchEventsList();
  }, [selectedEventKey, fetchEventsList]);

  // 3. Fetch Detailed Event Participants (On-Demand)
  const fetchEventDetails = useCallback(async (key: string, byId = true) => {
    if (inFlightDetailsRef.current?.name === key) return;
    inFlightDetailsRef.current?.controller.abort();
    const controller = new AbortController();
    inFlightDetailsRef.current = { name: key, controller };

    setLoadingDetails(true);
    setDetailsError(null);
    // Keep the detail view mounted while refreshing after recipient issuance.
    const localSummary = eventsRef.current.find((event) => byId ? event.eventId === key : event.eventName === key);
    setDetailedEventSummary((previous) => previous && (byId ? previous.eventId === key : previous.eventName === key)
      ? previous : localSummary ?? null);

    try {
      const query = new URLSearchParams({ [byId ? 'eventId' : 'event']: key, includeRowData: 'true' });
      const response = await apiFetch(`/api/dashboard?${query}`, { signal: controller.signal, cache: 'no-store' });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        logout();
        router.push('/login');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Failed to load event details');
      if (controller.signal.aborted) return;
      setDetailedEventSummary(data.event);
      setParticipants(data.participants || []);
      if (!byId && data.event.eventId) router.replace(`/dashboard?eventId=${data.event.eventId}`, { scroll: false });
    } catch (error) {
      if (!controller.signal.aborted) setDetailsError(error instanceof Error ? error.message : 'Failed to load event details');
    } finally {
      if (inFlightDetailsRef.current?.controller === controller) {
        setLoadingDetails(false);
        inFlightDetailsRef.current = null;
      }
    }
  }, [logout, router]);

  useEffect(() => {
    setParticipantSearchQuery('');
    setParticipantStatusFilter('all');
    setCertificateNotice(null);
    if (!selectedEventKey) {
      inFlightDetailsRef.current?.controller.abort();
      inFlightDetailsRef.current = null;
      setLoadingDetails(false);
      setDetailedEventSummary(null);
      setParticipants([]);
      setDetailsError(null);
      return;
    }
    void fetchEventDetails(selectedEventKey, Boolean(eventIdParam));
    return () => {
      inFlightDetailsRef.current?.controller.abort();
      inFlightDetailsRef.current = null;
    };
  }, [selectedEventKey, eventIdParam, fetchEventDetails]);

  async function handleCertificateAction(cert: DashboardParticipant, action: 'download' | 'email') {
    const eventId = detailedEventSummary?.eventId;
    if (!eventId || !cert.renderFields || workingCertificate) return;
    if (action === 'email') {
      if (!cert.recipientEmail || cert.mailStatus === 'unknown' || cert.mailStatus === 'sending') return;
      if (!window.confirm(cert.mailStatus === 'accepted'
        ? `Gmail already accepted this certificate email. Send another copy to ${cert.recipientEmail}?`
        : `Send the certificate to ${cert.recipientEmail} from your connected Gmail account?`)) return;
    }
    setCertificateNotice(null);
    setWorkingCertificate(cert.id);
    try {
      const { design, event, mailPreferences } = await fetchEventDesign(eventId);
      if (!design || !event.designLocked) throw new Error('The original design is unavailable.');
      const recipient = { id: cert.id, name: cert.recipientName };
      if (action === 'email') {
        const result = await emailIssuedCertificate(design, cert.renderFields, {
          ...recipient, email: cert.recipientEmail!, resendVersion: cert.mailStatus === 'accepted' ? cert.mailVersion ?? undefined : undefined,
        }, event.name, mailPreferences, cert.rowData);
        setCertificateNotice({ text: result.message, error: result.status !== 'success' });
      } else {
        const pdf = await renderIssuedPdf(design, cert.renderFields, recipient);
        downloadBlob(pdf.pdfBlob, `${pdf.filename}.pdf`);
      }
    } catch (error) {
      setCertificateNotice({ text: error instanceof Error ? error.message : 'The certificate action could not be completed.', error: true });
    } finally {
      if (action === 'email') await fetchEventDetails(eventId);
      setWorkingCertificate(null);
    }
  }

  // Return from detailed view to events list
  const handleBackToEventsList = () => {
    setDetailedEventSummary(null);
    setParticipants([]);
    setDetailsError(null);
    mainRef.current?.scrollTo({ top: 0 });
    router.push('/dashboard', { scroll: false });
    if (eventsRef.current.length === 0) {
      fetchEventsList();
    }
  };

  // Revoke or Reinstate Certificate
  const handleToggleRevoke = async (cert: DashboardParticipant) => {

    const isCurrentlyRevoked = cert.status === 'revoked';
    const actionName = isCurrentlyRevoked ? 'reinstate' : 'revoke';

    const confirmed = window.confirm(
      isCurrentlyRevoked
        ? `Reinstate certificate for "${cert.recipientName}"?`
        : `Are you sure you want to revoke the certificate for "${cert.recipientName}"? Public verification will flag it as revoked.`
    );
    if (!confirmed) return;

    setUpdatingCertId(cert.id);

    try {
      const res = await apiFetch(`/api/certificates/${cert.id}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reinstate: isCurrentlyRevoked }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to ${actionName} certificate`);
      }

      // Optimistic update in participants list
      setParticipants((prev) =>
        prev.map((c) =>
          c.id === cert.id ? { ...c, status: isCurrentlyRevoked ? 'issued' : 'revoked' } : c
        )
      );

      // Optimistic update in event summary
      setDetailedEventSummary((prev) =>
        prev
          ? {
              ...prev,
              activeCount: isCurrentlyRevoked ? prev.activeCount + 1 : prev.activeCount - 1,
              revokedCount: isCurrentlyRevoked ? prev.revokedCount - 1 : prev.revokedCount + 1,
            }
          : null
      );

      // Optimistic update in overall events summary
      setEvents((prev) =>
        prev.map((e) =>
          e.eventId === detailedEventSummary?.eventId
            ? {
                ...e,
                activeCount: isCurrentlyRevoked ? e.activeCount + 1 : e.activeCount - 1,
                revokedCount: isCurrentlyRevoked ? e.revokedCount - 1 : e.revokedCount + 1,
              }
            : e
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${actionName} certificate`);
    } finally {
      setUpdatingCertId(null);
    }
  };

  // Export Event CSV
  const handleExportEventCsv = () => {
    if (!detailedEventSummary || participants.length === 0) return;

    const headers = [
      '#',
      'Certificate ID',
      'Recipient Name',
      'Recipient Email',
      'Status',
      'Issued At',
      'Template Name',
      'Verification URL',
    ];

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const rows = participants.map((cert, idx) => {
      return [
        (idx + 1).toString(),
        csvCell(cert.id),
        csvCell(cert.recipientName || ''),
        csvCell(cert.recipientEmail || ''),
        csvCell(cert.status.toUpperCase()),
        csvCell(cert.issuedAt),
        csvCell(cert.templateName || ''),
        csvCell(`${origin}/verify/${cert.id}`),
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `event_${sanitizeFilename(detailedEventSummary.eventName)}_${new Date().toISOString().split('T')[0]}.csv`;
    downloadBlob(blob, filename);
  };

  // Fresh Studio entry: Reset state completely so no stale session lingers
  const handleOpenNewStudio = () => {
    useAppStore.getState().reset();
    useHistoryStore.getState().clearHistory();
    router.push('/editor');
  };

  function handleCopyEvent() {
    const id = detailedEventSummary?.eventId;
    if (id) router.push(`/editor?copyEvent=${id}`);
  }

  // Filtered list of registered events
  const filteredEvents = useMemo(() => {
    const q = eventSearchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.eventName.toLowerCase().includes(q) ||
        (e.label && e.label.toLowerCase().includes(q)) || (e.templateName && e.templateName.toLowerCase().includes(q))
    );
  }, [events, eventSearchQuery]);

  // Status counts for participant tabs in detailed view
  const { totalParticipantCount, activeParticipantCount, revokedParticipantCount } = useMemo(() => {
    if (participants.length > 0) {
      let active = 0;
      let revoked = 0;
      for (const p of participants) {
        if (p.status === 'revoked') revoked++;
        else active++;
      }
      return {
        totalParticipantCount: participants.length,
        activeParticipantCount: active,
        revokedParticipantCount: revoked,
      };
    }
    return {
      totalParticipantCount: detailedEventSummary?.certificateCount ?? 0,
      activeParticipantCount: detailedEventSummary?.activeCount ?? 0,
      revokedParticipantCount: detailedEventSummary?.revokedCount ?? 0,
    };
  }, [participants, detailedEventSummary]);

  // Filtered list of participants within detailed view
  const filteredParticipants = useMemo(() => {
    const q = participantSearchQuery.trim().toLowerCase();

    return participants.filter((p) => {
      if (participantStatusFilter === 'issued' && p.status !== 'issued' && p.status !== 'static') {
        return false;
      }
      if (participantStatusFilter === 'revoked' && p.status !== 'revoked') {
        return false;
      }
      if (!q) return true;

      // Match name, email, cert ID
      return (
        p.recipientName.toLowerCase().includes(q) ||
        (p.recipientEmail && p.recipientEmail.toLowerCase().includes(q)) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [participants, participantSearchQuery, participantStatusFilter]);

  return (
    <div className="animate-fade-in h-screen h-dvh bg-app-background text-slate-900 flex flex-col font-sans overflow-hidden">
      <WeCertifyHeader>
          {canModerate && (
            <Link
              href="/admin"
              aria-label="Manage access"
              title="Manage access"
              className="inline-flex min-h-10 items-center gap-2 px-2 text-sm font-semibold text-slate-800 hover:text-primary-700"
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Manage access</span>
            </Link>
          )}
          {/* Quick link to Canvas Studio */}
          <button
            type="button"
            onClick={handleOpenNewStudio}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-app-border bg-white px-2.5 text-sm font-semibold text-slate-800 hover:bg-app-background hover:text-primary-700 sm:px-3.5"
            aria-label="Canvas Studio"
            title="Open Certificate Canvas Studio"
          >
            <Palette className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Canvas Studio</span>
          </button>

      </WeCertifyHeader>

      {/* ------------------------------------------------------------- */}
      {/* Main Scrollable Container (Scrollbar strictly below header)    */}
      {/* ------------------------------------------------------------- */}
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        {/* ========================================================= */}
        {/* VIEW A: Single Event Detailed View (On-Demand)            */}
        {/* ========================================================= */}
        {selectedEventKey ? (
          <div key={`event-${selectedEventKey}`} className="animate-fade-in space-y-4">
            {/* Detailed View Header & Back Button Directly On Page */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-3.5 border-b border-[#E5DAC3] min-h-[58px]">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={handleBackToEventsList}
                  className="flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors p-1.5 -ml-1.5 rounded-lg hover:bg-[#EFE5D0]/70 active:scale-90 shrink-0 cursor-pointer"
                  title="Back to Registered Events"
                  aria-label="Back to Registered Events"
                >
                  <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
                </button>
                <div className="min-w-0">
                  <h1 className="page-title text-slate-900 truncate">
                    {selectedEventName || 'Event'}{detailedEventSummary?.label ? ` · ${detailedEventSummary.label}` : ''}
                  </h1>
                  {detailedEventSummary && (
                    <div className="flex items-center gap-2 mt-0.5 text-xs font-medium text-slate-600 flex-wrap">
                      <span className="font-bold text-slate-900 tabular-nums">
                        {detailedEventSummary.certificateCount} {detailedEventSummary.certificateCount === 1 ? 'record' : 'records'}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span className="text-stone-600 font-medium">
                        Issued {new Date(detailedEventSummary.lastIssuedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap sm:flex-nowrap">
                <button
                  type="button"
                  onClick={handleExportEventCsv}
                  disabled={participants.length === 0}
                  className="h-9 inline-flex items-center gap-1.5 px-3 bg-white hover:bg-slate-100 text-slate-800 hover:text-slate-900 border border-[#E5DAC3] rounded-lg text-sm font-semibold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyEvent}
                  disabled={!detailedEventSummary?.eventId}
                  className="h-9 inline-flex items-center gap-1.5 px-3.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" />
                  Make a copy
                </button>
              </div>
            </div>

            {detailedEventSummary?.eventId && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 py-3 px-4 rounded-xl border border-[#E5DAC3] bg-white/60 text-xs sm:text-sm">
                {/* Verification activity (opt-in aggregate counting) */}
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(detailedEventSummary.trackScans)}
                    onClick={() => void handleUpdateEventSettings({
                      trackScans: !detailedEventSummary.trackScans,
                    })}
                    disabled={eventSettingsSaving}
                    className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: detailedEventSummary.trackScans ? '#10b981' : '#d6d3d1' }}
                    title="Count how often recipients open this event's verification pages"
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
                      style={{ transform: detailedEventSummary.trackScans ? 'translateX(18px)' : 'translateX(3px)' }}
                    />
                  </button>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">
                      Track verification views
                    </p>
                    <p className="text-[11px] text-stone-500">
                      {detailedEventSummary.trackScans
                        ? detailedEventSummary.scanSummary && detailedEventSummary.scanSummary.totalScans > 0
                          ? `${detailedEventSummary.scanSummary.totalScans.toLocaleString()} view${detailedEventSummary.scanSummary.totalScans === 1 ? '' : 's'} · last ${detailedEventSummary.scanSummary.lastScannedAt ? new Date(detailedEventSummary.scanSummary.lastScannedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}`
                          : 'On — no views recorded yet'
                        : 'Off (nothing is recorded)'}
                    </p>
                  </div>
                </div>

                {/* Validity window */}
                <div className="flex items-center gap-2.5 sm:ml-auto">
                  <CalendarDays className="w-4 h-4 text-stone-400 shrink-0" />
                  <div>
                    <label className="block font-semibold text-slate-700">
                      Valid through <span className="text-stone-400 font-medium">(optional)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={validThroughDateInput}
                        onChange={(e) => void handleUpdateEventSettings({
                          validThrough: e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null,
                        })}
                        disabled={eventSettingsSaving}
                        className="mt-0.5 px-2 py-1 rounded-lg border border-[#E5DAC3] bg-white text-xs text-slate-800 focus:outline-none focus:ring-0 focus:border-slate-400 cursor-pointer disabled:opacity-50"
                      />
                      {detailedEventSummary.validThrough && (
                        <button
                          type="button"
                          onClick={() => void handleUpdateEventSettings({ validThrough: null })}
                          className="text-[11px] font-semibold text-stone-500 hover:text-red-600 transition-colors cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {detailedEventSummary?.eventId && detailedEventSummary.designLocked && (
              <EventMailQueue key={detailedEventSummary.eventId} eventId={detailedEventSummary.eventId}
                participants={participants} onChange={() => fetchEventDetails(detailedEventSummary.eventId!)} />
            )}

            {detailedEventSummary?.eventId && (
              <EventRecipients key={detailedEventSummary.eventId} eventId={detailedEventSummary.eventId}
                eventName={detailedEventSummary.eventName} designLocked={Boolean(detailedEventSummary.designLocked)}
                participants={participants} onChange={() => fetchEventDetails(detailedEventSummary.eventId!)} />
            )}
            {certificateNotice && <p role="status" className={`text-sm ${certificateNotice.error ? 'text-red-700' : 'text-slate-700'}`}>{certificateNotice.text}</p>}

            {detailsError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{detailsError}</span>
              </div>
            )}

            {/* Filters & Participant Search Bar Directly On Page */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <div className="relative flex-1 w-full sm:max-w-md">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={participantSearchQuery}
                  onChange={(e) => setParticipantSearchQuery(e.target.value)}
                  placeholder="Filter by name, email, or cert ID..."
                  aria-label="Filter participants"
                  className="form-control-text min-h-11 w-full rounded-md border border-stone-400 bg-white pr-3 pl-8.5 text-slate-900 placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-primary-600 sm:min-h-9"
                />
              </div>

              <div className="flex items-center gap-1 text-xs w-full sm:w-auto">
                <button
                  onClick={() => setParticipantStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    participantStatusFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-slate-100'
                  }`}
                >
                  All ({totalParticipantCount})
                </button>
                <button
                  onClick={() => setParticipantStatusFilter('issued')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    participantStatusFilter === 'issued'
                      ? 'bg-emerald-700 text-white'
                      : 'text-stone-600 hover:text-emerald-800 hover:bg-slate-100'
                  }`}
                >
                  Active ({activeParticipantCount})
                </button>
                <button
                  onClick={() => setParticipantStatusFilter('revoked')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    participantStatusFilter === 'revoked'
                      ? 'bg-red-700 text-white'
                      : 'text-stone-600 hover:text-red-800 hover:bg-slate-100'
                  }`}
                >
                  Revoked ({revokedParticipantCount})
                </button>
              </div>
            </div>

            {/* Detailed Table Directly On Page */}
            <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs">
              {loadingDetails ? (
                <div className="py-6 px-3.5 space-y-2.5">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="h-8 bg-stone-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : filteredParticipants.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">No participant records found</p>
                  <p className="text-xs text-stone-500">
                    {participants.length === 0
                      ? 'No certificates issued for this event yet.'
                      : 'No records match your search filter.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FBF4E2] border-b-2 border-[#E5DAC3] text-xs font-semibold text-[#554633]">
                        <th className="py-2.5 sm:py-3 px-3 w-10 text-right">#</th>
                        <th className="py-2.5 sm:py-3 px-3 text-left">Participant Name</th>
                        <th className="py-2.5 sm:py-3 px-3 text-right w-44">Email</th>
                        <th className="py-2.5 sm:py-3 px-3 text-right w-36">Certificate ID</th>
                        <th className="py-2.5 sm:py-3 px-3 text-right w-32">Issued Date</th>
                        <th className="py-2.5 sm:py-3 px-3 text-right w-24">Status</th>
                        <th className="py-2.5 sm:py-3 px-3 text-right w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE5D0] font-normal text-slate-800">
                      {filteredParticipants.map((cert, index) => {
                        const isRevoked = cert.status === 'revoked';
                        const isStatic = cert.status === 'static';
                        const isUpdating = updatingCertId === cert.id;

                        return (
                          <tr
                            key={cert.id}
                            className="hover:bg-slate-100/80 transition-colors"
                          >
                            <td className="py-2 px-3 text-right text-stone-400 text-xs tabular-nums font-medium">
                              {index + 1}
                            </td>
                            <td className="py-2 px-3 text-left text-sm font-semibold text-slate-900">
                              {cert.recipientName}
                            </td>
                            <td className="py-2 px-3 text-right text-stone-600 font-medium text-xs">
                              {cert.recipientEmail || '—'}
                              {cert.recipientEmail && <p className="text-xs text-stone-500" title={cert.mailDetail ?? undefined}>{mailStatusLabels[cert.mailStatus]}</p>}
                            </td>
                            <td className="py-2 px-3 text-right text-xs">
                              {isStatic ? (
                                <span
                                  className="text-stone-500 text-xs"
                                  title={`Static Certificate ID: ${cert.id}`}
                                >
                                  {cert.id.slice(0, 8)}...
                                </span>
                              ) : (
                                <a
                                  href={`/verify/${cert.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 hover:underline font-medium"
                                  title={`Open verification page (${cert.id})`}
                                >
                                  <span>{cert.id.slice(0, 8)}...</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-stone-700 font-medium tabular-nums whitespace-nowrap text-xs">
                              {new Date(cert.issuedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {isRevoked ? (
                                <span className="text-xs font-medium text-red-700">
                                  Revoked
                                </span>
                              ) : isStatic ? (
                                <span className="text-xs font-medium text-stone-600">
                                  Static
                                </span>
                              ) : (
                                <span className="text-xs font-medium text-emerald-700">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {cert.renderFields && !isRevoked && (
                                <button type="button" onClick={() => void handleCertificateAction(cert, 'download')}
                                  disabled={Boolean(workingCertificate)} aria-label={`Download certificate for ${cert.recipientName}`}
                                  className="mr-2 text-slate-600 hover:text-slate-900 disabled:opacity-50">
                                  <Download className="inline h-4 w-4" />
                                </button>
                              )}
                              {cert.renderFields && !isRevoked && cert.recipientEmail && cert.mailStatus !== 'unknown' && cert.mailStatus !== 'sending' && (
                                <button type="button" onClick={() => void handleCertificateAction(cert, 'email')}
                                  disabled={Boolean(workingCertificate)} aria-label={`${cert.mailStatus === 'accepted' ? 'Resend' : 'Email'} certificate to ${cert.recipientName}`}
                                  className="mr-2 text-slate-600 hover:text-slate-900 disabled:opacity-50">
                                  <Mail className="inline h-4 w-4" />
                                </button>
                              )}
                              {isStatic ? (
                                <span
                                  className="text-stone-400 text-xs font-medium"
                                  title="Static records cannot be revoked or reinstated"
                                >
                                  —
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleToggleRevoke(cert)}
                                  disabled={isUpdating}
                                  className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                    isRevoked
                                      ? 'text-emerald-700 hover:text-emerald-800 hover:underline'
                                      : 'text-red-600 hover:text-red-700 hover:underline'
                                  }`}
                                  title={isRevoked ? 'Reinstate certificate' : 'Revoke certificate'}
                                >
                                  {isUpdating && <RefreshCw className="w-3 h-3 animate-spin" />}
                                  <span>{isRevoked ? 'Reinstate' : 'Revoke'}</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* VIEW B: Single Page View (Header on top, Records on bottom) */
          /* ========================================================= */
          <div key="events-list" className="animate-fade-in space-y-4">
            {/* Top Section Directly On Page */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-3.5 border-b border-[#E5DAC3] min-h-[58px]">
              <div>
                <h1 className="page-title text-slate-900">
                  Registered Events &amp; Certificates
                </h1>
                <p className="mt-1 text-sm leading-relaxed text-stone-700">
                  Open an event to view recipients, download certificates, or manage revocations.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={handleOpenNewStudio}
                  className="h-9 inline-flex items-center gap-2 px-3.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold transition-all shadow-2xs hover:shadow-xs cursor-pointer active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4 stroke-[2.25] shrink-0" />
                  <span>Add New Certificates</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Search Toolbar */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-xs sm:max-w-sm">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={eventSearchQuery}
                  onChange={(e) => setEventSearchQuery(e.target.value)}
                  placeholder="Filter registered events..."
                  aria-label="Filter registered events"
                  className="form-control-text min-h-11 w-full rounded-md border border-stone-400 bg-white pr-3 pl-8.5 text-slate-900 placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-primary-600 sm:min-h-9"
                />
              </div>

              <div className="flex items-center">
                <span className="text-xs font-semibold text-stone-500">
                  {filteredEvents.length} {filteredEvents.length === 1 ? 'batch' : 'batches'}
                </span>
              </div>
            </div>

            {/* List of Present Records Directly On Page */}
            {loading && events.length === 0 ? (
              <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs divide-y divide-[#EFE5D0]">
                <div className="hidden md:grid dashboard-events-grid px-3.5 py-2.5 sm:py-3 text-xs font-semibold text-[#554633] bg-[#FBF4E2] border-b-2 border-[#E5DAC3]">
                  <div className="text-left">Event Name</div>
                  <div className="text-right">Date Issued</div>
                  <div className="text-right">Records</div>
                  <div className="text-right">Active</div>
                  <div className="text-right">Revoked</div>
                  <div></div>
                </div>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="px-3.5 py-2 sm:py-2.5 animate-pulse dashboard-events-grid gap-1.5 md:gap-0">
                    <div className="space-y-1 pr-3">
                      <div className="h-4 w-44 bg-stone-200 rounded" />
                      <div className="h-3 w-28 bg-stone-100 rounded" />
                    </div>
                    <div className="h-4 w-24 bg-stone-100 rounded md:ml-auto" />
                    <div className="h-4 w-16 bg-stone-100 rounded md:ml-auto" />
                    <div className="h-4 w-16 bg-stone-100 rounded md:ml-auto" />
                    <div className="h-4 w-16 bg-stone-100 rounded md:ml-auto" />
                    <div className="h-4 w-4 bg-stone-100 rounded md:ml-auto" />
                  </div>
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              <section className="space-y-1.5 border-t border-app-border py-7" aria-labelledby="events-empty-title">
                <h2 id="events-empty-title" className="section-title text-slate-900">
                  {events.length === 0 ? 'No registered events yet' : 'No matching events'}
                </h2>
                <p className="text-sm leading-relaxed text-stone-700">
                  {events.length === 0
                    ? 'Create your first certificate batch in Canvas Studio.'
                    : 'Try a different event name.'}
                </p>
              </section>
            ) : (
              <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs">
                {/* Desktop Column Header */}
                <div className="hidden md:grid dashboard-events-grid px-3.5 py-2.5 sm:py-3 text-xs font-semibold text-[#554633] bg-[#FBF4E2] border-b-2 border-[#E5DAC3]">
                  <div className="text-left">Event Name</div>
                  <div className="text-right">Date Issued</div>
                  <div className="text-right">Records</div>
                  <div className="text-right">Active</div>
                  <div className="text-right">Revoked</div>
                  <div></div>
                </div>

                {/* Direct On-Page Rows */}
                <div className="divide-y divide-[#EFE5D0]">
                  {filteredEvents.map((event) => (
                    <div
                      key={event.eventId ?? event.eventName}
                      onClick={() => {
                        router.push(`/dashboard?eventId=${event.eventId}`, { scroll: false });
                      }}
                      className="group px-3.5 py-2 sm:py-2.5 hover:bg-slate-100/80 transition-colors cursor-pointer dashboard-events-grid gap-1.5 md:gap-0"
                    >
                      {/* Column 1: Event Name & Template */}
                      <div className="pr-3 min-w-0 text-left">
                        <h2 className="text-sm font-semibold text-slate-900 group-hover:text-primary-700 transition-colors truncate">
                          {event.eventName}{event.label ? ` · ${event.label}` : ''}
                        </h2>
                        {event.templateName && (
                          <p className="text-xs text-stone-700 truncate mt-0.5">
                            Template: {event.templateName}
                          </p>
                        )}
                      </div>

                      {/* Column 2: Date of Issuance */}
                      <div className="text-xs font-medium text-stone-700 whitespace-nowrap text-left md:text-right tabular-nums">
                        <span className="md:hidden text-xs font-medium text-stone-500 mr-1.5">Issued:</span>
                        <span>
                          {new Date(event.lastIssuedAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      {/* Columns 3, 4, 5: Metrics (Records, Active, Revoked) */}
                      <div className="flex md:contents items-center justify-between pt-1 border-t border-[#EFE5D0] md:border-t-0 md:pt-0">
                        {/* Records */}
                        <div className="text-xs whitespace-nowrap md:text-right">
                          <span className="font-bold text-slate-900 tabular-nums">{event.certificateCount}</span>
                          <span className="text-xs font-semibold text-stone-500 ml-1">
                            {event.certificateCount === 1 ? 'record' : 'records'}
                          </span>
                        </div>

                        {/* Active */}
                        <div className="text-xs whitespace-nowrap md:text-right">
                          <span className="font-semibold text-emerald-700 tabular-nums">{event.activeCount}</span>
                          <span className="text-xs font-semibold text-stone-500 ml-1">active</span>
                        </div>

                        {/* Revoked */}
                        <div className="text-xs whitespace-nowrap md:text-right">
                          <span
                            className={`font-bold tabular-nums ${
                              event.revokedCount > 0 ? 'text-red-700' : 'text-stone-400'
                            }`}
                          >
                            {event.revokedCount}
                          </span>
                          <span className="text-xs font-semibold text-stone-500 ml-1">revoked</span>
                        </div>
                      </div>

                      <div className="flex justify-end pr-1">
                        <ChevronRight className="h-4 w-4 text-stone-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FBFAF5]" style={{ backgroundColor: '#FBFAF5' }}>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-slate-600 text-xs font-medium">Loading dashboard...</p>
          </div>
        </div>
      }
    >
      <IssuerWorkspace>
        <DashboardContent />
      </IssuerWorkspace>
    </Suspense>
  );
}
