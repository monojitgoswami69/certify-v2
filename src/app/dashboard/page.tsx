'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ChevronRight,
  ChevronLeft,
  Palette,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { downloadBlob, sanitizeFilename } from '../../lib/utils';
import type { DashboardEventSummary, DashboardParticipant } from '../api/dashboard/route';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    localStorage.getItem('credify_auth_token') ||
    sessionStorage.getItem('credify_session_token') ||
    localStorage.getItem('certify_auth_token') ||
    sessionStorage.getItem('certify_session_token')
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventParam = searchParams.get('event');
  const { isAuthenticated, isLoading: authLoading, token, logout, initialize } = useAuthStore();

  // Events summary list state
  const [events, setEvents] = useState<DashboardEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search in Registered Events list
  const [eventSearchQuery, setEventSearchQuery] = useState('');

  // -------------------------------------------------------------
  // Detailed View State (On-Demand Fetching for a single event)
  // -------------------------------------------------------------
  const [selectedEventName, setSelectedEventName] = useState<string | null>(null);
  const [detailedEventSummary, setDetailedEventSummary] = useState<DashboardEventSummary | null>(null);
  const [participants, setParticipants] = useState<DashboardParticipant[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Search & Status filters within detailed participant view
  const [participantSearchQuery, setParticipantSearchQuery] = useState('');
  const [participantStatusFilter, setParticipantStatusFilter] = useState<'all' | 'issued' | 'revoked'>('all');

  // Revoking state for row-level spinners
  const [updatingCertId, setUpdatingCertId] = useState<string | null>(null);

  // Deleting event state
  const [deletingEventName, setDeletingEventName] = useState<string | null>(null);

  // 1. Mount Effect: Initialize Auth
  useEffect(() => {
    initialize();
  }, [initialize]);

  // 2. Fetch Events List (Fresh call on mount / reload)
  const fetchEventsList = useCallback(async (explicitToken?: string) => {
    const activeToken = explicitToken || token || getStoredToken();
    if (!activeToken) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/dashboard', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
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
    }
  }, [token, logout, router]);

  // Trigger fetch as soon as active token exists
  useEffect(() => {
    const activeToken = token || getStoredToken();
    if (activeToken) {
      fetchEventsList(activeToken);
    } else if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [token, authLoading, isAuthenticated, fetchEventsList, router]);

  // 3. Fetch Detailed Event Participants (On-Demand)
  const fetchEventDetails = useCallback(
    async (eventName: string) => {
      const activeToken = token || getStoredToken();
      if (!activeToken) return;

      setSelectedEventName(eventName);
      setLoadingDetails(true);
      setDetailsError(null);
      setParticipantSearchQuery('');
      setParticipantStatusFilter('all');

      // Pre-populate summary from local list if available
      const localSummary = events.find((e) => e.eventName === eventName);
      if (localSummary) {
        setDetailedEventSummary(localSummary);
      }

      try {
        const res = await fetch(`/api/dashboard?event=${encodeURIComponent(eventName)}`, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });

        if (res.status === 401) {
          logout();
          router.push('/login');
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || 'Failed to load event details');
        }

        const data = await res.json();
        setDetailedEventSummary(data.event);
        setParticipants(data.participants || []);
      } catch (err) {
        setDetailsError(err instanceof Error ? err.message : 'Failed to load event details');
      } finally {
        setLoadingDetails(false);
      }
    },
    [token, events, logout, router]
  );

  // Auto-open event detailed report if ?event= query parameter is present in URL
  useEffect(() => {
    if (!eventParam || !isAuthenticated) return;
    if (selectedEventName !== eventParam) {
      fetchEventDetails(eventParam);
    }
  }, [eventParam, isAuthenticated, selectedEventName, fetchEventDetails]);

  // Return from detailed view to events list
  const handleBackToEventsList = () => {
    setSelectedEventName(null);
    setDetailedEventSummary(null);
    setParticipants([]);
    setDetailsError(null);
    router.push('/dashboard', { scroll: false });
  };

  // Revoke or Reinstate Certificate
  const handleToggleRevoke = async (cert: DashboardParticipant) => {
    const activeToken = token || getStoredToken();
    if (!activeToken) return;

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
      const res = await fetch(`/api/certificates/${cert.id}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
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
          e.eventName === selectedEventName
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

  // Delete Event and All Associated Certificates & Templates
  const handleDeleteEvent = async (eventName: string) => {
    const activeToken = token || getStoredToken();
    if (!activeToken) return;

    const eventSummary = events.find((e) => e.eventName === eventName) || detailedEventSummary;
    const certCount = eventSummary ? eventSummary.certificateCount : participants.length;

    const confirmed = window.confirm(
      `Are you sure you want to permanently delete event "${eventName}" and all ${certCount} connected certificate record(s)?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingEventName(eventName);

    try {
      const res = await fetch(`/api/dashboard?event=${encodeURIComponent(eventName)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete event');
      }

      // If viewing this event in detailed view, return to events list
      if (selectedEventName === eventName) {
        setSelectedEventName(null);
        setDetailedEventSummary(null);
        setParticipants([]);
        router.push('/dashboard', { scroll: false });
      }

      // Remove from local events list
      setEvents((prev) => prev.filter((e) => e.eventName !== eventName));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete event');
    } finally {
      setDeletingEventName(null);
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
        `"${cert.id}"`,
        `"${(cert.recipientName || '').replace(/"/g, '""')}"`,
        `"${(cert.recipientEmail || '').replace(/"/g, '""')}"`,
        `"${cert.status.toUpperCase()}"`,
        `"${cert.issuedAt}"`,
        `"${(cert.templateName || '').replace(/"/g, '""')}"`,
        `"${origin}/verify/${cert.id}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `event_${sanitizeFilename(detailedEventSummary.eventName)}_${new Date().toISOString().split('T')[0]}.csv`;
    downloadBlob(blob, filename);
  };

  // Open Event Template in Studio to Add New Records
  const [loadingStudio, setLoadingStudio] = useState(false);
  const handleOpenEventInStudio = async () => {
    const evName = (detailedEventSummary?.eventName || selectedEventName || '').trim();
    if (!evName) return;
    setLoadingStudio(true);

    try {
      const activeToken = token || getStoredToken();
      if (!activeToken) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/templates', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });

      if (!res.ok) {
        router.push('/editor');
        return;
      }

      const data = await res.json();
      const templatesList = data.templates || [];

      const evNameLower = evName.toLowerCase();
      const tplName = (detailedEventSummary?.templateName || '').trim();
      const tplNameLower = tplName.toLowerCase();
      const tplBaseNameLower = tplName.replace(/\.[^/.]+$/, '').trim().toLowerCase();

      // Priority 1: Match by exact event name (how autoSaveCurrentTemplate saves it)
      let match = evNameLower
        ? templatesList.find((t: { name: string }) => (t.name || '').trim().toLowerCase() === evNameLower)
        : null;

      // Priority 2: Match by exact template filename (e.g. sample-template.png)
      if (!match && tplNameLower) {
        match = templatesList.find((t: { name: string }) => (t.name || '').trim().toLowerCase() === tplNameLower);
      }

      // Priority 3: Match by template base name (e.g. sample-template)
      if (!match && tplBaseNameLower) {
        match = templatesList.find((t: { name: string }) => (t.name || '').trim().toLowerCase() === tplBaseNameLower);
      }

      // Priority 4: Substring / fuzzy match
      if (!match) {
        match = templatesList.find((t: { name: string }) => {
          const tn = (t.name || '').trim().toLowerCase();
          return (
            (evNameLower && (tn.includes(evNameLower) || evNameLower.includes(tn))) ||
            (tplBaseNameLower && (tn.includes(tplBaseNameLower) || tplBaseNameLower.includes(tn)))
          );
        });
      }

      // Priority 5: If there's only 1 saved template in the entire account, use it
      if (!match && templatesList.length === 1) {
        match = templatesList[0];
      }

      if (!match) {
        alert(`No saved canvas template layout found for event "${evName}". Opening Studio...`);
        router.push('/editor');
        return;
      }

      // Fetch the full template detail with imageData
      const detailRes = await fetch(`/api/templates/${match.id}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });

      if (!detailRes.ok) {
        throw new Error('Failed to fetch template details');
      }

      const detailData = await detailRes.json();
      const tpl = detailData.template;
      if (!tpl?.imageData) {
        throw new Error('Template graphic data is missing');
      }

      // Convert Base64 data URL to Image and File
      const blobRes = await fetch(tpl.imageData);
      const blob = await blobRes.blob();
      const filename = `${tpl.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      await new Promise<void>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => {
          const info = `${file.name} (${img.width}×${img.height})`;
          const store = useAppStore.getState();
          store.setTemplate(file, img, info);
          if (tpl.layoutConfig?.boxes && Array.isArray(tpl.layoutConfig.boxes)) {
            store.setBoxes(tpl.layoutConfig.boxes);
          }
          if (tpl.layoutConfig?.qrZones && Array.isArray(tpl.layoutConfig.qrZones)) {
            store.setQrZones(tpl.layoutConfig.qrZones);
          }
          if (tpl.layoutConfig?.defaultFont) {
            store.setDefaultFont(tpl.layoutConfig.defaultFont);
          }
          if (tpl.layoutConfig?.defaultFontSize) {
            store.setDefaultFontSize(tpl.layoutConfig.defaultFontSize);
          }
          if (tpl.layoutConfig?.defaultFontColor) {
            store.setDefaultFontColor(tpl.layoutConfig.defaultFontColor);
          }
          if (evName) {
            store.setEventName(evName);
          }
          resolve();
        };
        img.onerror = () => reject(new Error('Failed to decode template graphic'));
        img.src = tpl.imageData;
      });

      router.push(`/editor?templateId=${match.id}&event=${encodeURIComponent(evName)}`);
    } catch (err) {
      console.error('[Open in Studio Error]:', err);
      alert(err instanceof Error ? err.message : 'Error opening event in Studio');
      router.push('/editor');
    } finally {
      setLoadingStudio(false);
    }
  };

  // Filtered list of registered events
  const filteredEvents = useMemo(() => {
    const q = eventSearchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.eventName.toLowerCase().includes(q) ||
        (e.templateName && e.templateName.toLowerCase().includes(q))
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

  // Redirect if completely unauthenticated with no stored token
  if (!authLoading && !isAuthenticated && !getStoredToken()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBFAF5]" style={{ backgroundColor: '#FBFAF5' }}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-600 text-xs font-medium">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFAF5] text-slate-900 flex flex-col font-sans" style={{ backgroundColor: '#FBFAF5' }}>
      {/* ------------------------------------------------------------- */}
      {/* Clean Light Navbar Header (Matching Canvas Workspace)         */}
      {/* ------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 bg-[#FBF4E2]/95 backdrop-blur-md border-b border-[#E5DAC3] px-4 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between shadow-2xs" style={{ backgroundColor: '#FBF4E2' }}>
        <div className="flex items-center gap-1.5">
          <Image
            src="/credify-logo.png"
            alt="Credify Logo"
            width={36}
            height={36}
            className="w-9 h-9 object-contain shrink-0"
            priority
          />
          <div className="flex flex-col justify-center">
            <span className="font-bold text-sm sm:text-base text-slate-900 tracking-tight leading-tight">Credify</span>
            <p className="text-[11px] sm:text-xs text-stone-500 hidden sm:block leading-tight mt-0.5">Certificate Verification &amp; Registry</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick link to Canvas Studio */}
          <button
            onClick={() => router.push('/editor')}
            className="flex items-center gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-lg text-xs sm:text-sm font-semibold border border-[#E5DAC3] transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98]"
            title="Open Certificate Canvas Studio"
          >
            <Palette className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden sm:inline">Canvas Studio</span>
          </button>

          {/* Logout */}
          <button
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 bg-red-50 hover:bg-red-100/90 text-red-600 hover:text-red-700 rounded-lg text-xs sm:text-sm font-semibold border border-red-200/90 hover:border-red-300 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98]"
            title="Log Out"
          >
            <LogOut className="w-3.5 h-3.5 text-red-500 group-hover:text-red-600" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* Main Container                                                */}
      {/* ------------------------------------------------------------- */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        {/* ========================================================= */}
        {/* VIEW A: Single Event Detailed View (On-Demand)            */}
        {/* ========================================================= */}
        {selectedEventName ? (
          <div className="space-y-4">
            {/* Detailed View Header & Back Button Directly On Page */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 sm:pb-3.5 border-b border-[#E5DAC3]">
              <div className="flex items-start gap-2">
                <button
                  onClick={handleBackToEventsList}
                  className="flex items-center justify-center text-slate-500 hover:text-slate-900 transition-all cursor-pointer hover:-translate-x-0.5 active:scale-90 shrink-0 mt-0.5 p-0.5"
                  title="Back to Registered Events"
                  aria-label="Back to Registered Events"
                >
                  <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
                </button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                    {selectedEventName}
                  </h1>
                  {detailedEventSummary && (
                    <div className="flex items-center gap-2 mt-1 text-xs font-medium text-slate-600 flex-wrap">
                      <span className="font-bold text-slate-900">
                        {detailedEventSummary.certificateCount} {detailedEventSummary.certificateCount === 1 ? 'record' : 'records'}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span className="text-stone-600">
                        Issued {new Date(detailedEventSummary.lastIssuedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto pl-7 sm:pl-0">
                <button
                  onClick={handleExportEventCsv}
                  disabled={participants.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-white hover:bg-slate-100 text-slate-800 hover:text-slate-900 border border-[#E5DAC3] rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={handleOpenEventInStudio}
                  disabled={loadingStudio}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-50"
                  title="Open this event's template & layout in Canvas Studio to issue new certificates"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{loadingStudio ? 'Opening...' : 'Open in Studio'}</span>
                </button>

                <button
                  onClick={() => selectedEventName && handleDeleteEvent(selectedEventName)}
                  disabled={deletingEventName === selectedEventName}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-white hover:bg-red-50 text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-50"
                  title={`Permanently delete event "${selectedEventName}" and all its certificates`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingEventName === selectedEventName ? 'Deleting...' : 'Delete Event'}</span>
                </button>
              </div>
            </div>

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
                  className="w-full pl-8.5 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-[#E5DAC3] rounded-lg text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-0 focus:border-slate-400 transition-all shadow-2xs"
                />
              </div>

              <div className="flex items-center gap-1 text-xs w-full sm:w-auto">
                <button
                  onClick={() => setParticipantStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    participantStatusFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-slate-100'
                  }`}
                >
                  All ({totalParticipantCount})
                </button>
                <button
                  onClick={() => setParticipantStatusFilter('issued')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    participantStatusFilter === 'issued'
                      ? 'bg-emerald-700 text-white'
                      : 'text-stone-600 hover:text-emerald-800 hover:bg-slate-100'
                  }`}
                >
                  Active ({activeParticipantCount})
                </button>
                <button
                  onClick={() => setParticipantStatusFilter('revoked')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
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
                      <tr className="bg-[#FBF4E2] border-b-2 border-[#E5DAC3] text-[11px] sm:text-xs font-bold text-[#554633] uppercase tracking-wider">
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
                            <td className="py-2 px-3 text-right text-stone-400 font-mono text-xs tabular-nums">
                              {index + 1}
                            </td>
                            <td className="py-2 px-3 text-left text-[13px] font-semibold text-slate-900">
                              {cert.recipientName}
                            </td>
                            <td className="py-2 px-3 text-right text-stone-600 font-mono text-xs">
                              {cert.recipientEmail || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-xs">
                              {isStatic ? (
                                <span
                                  className="text-stone-500 font-mono text-xs"
                                  title={`Static Certificate ID: ${cert.id}`}
                                >
                                  {cert.id.slice(0, 8)}...
                                </span>
                              ) : (
                                <a
                                  href={`/verify/${cert.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 hover:underline font-semibold"
                                  title={`Open verification page (${cert.id})`}
                                >
                                  <span>{cert.id.slice(0, 8)}...</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-stone-700 font-medium whitespace-nowrap text-xs">
                              {new Date(cert.issuedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {isRevoked ? (
                                <span className="text-xs font-semibold text-red-700">
                                  Revoked
                                </span>
                              ) : isStatic ? (
                                <span className="text-xs font-semibold text-stone-600">
                                  Static
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-emerald-700">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
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
          <div className="space-y-4">
            {/* Top Section Directly On Page */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 sm:pb-3.5 border-b border-[#E5DAC3]">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Registered Events &amp; Certificates
                </h1>
                <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
                  Browse all issued credential batches. Click on any event to inspect participant records and manage revocations.
                </p>
              </div>

              <button
                onClick={() => router.push('/editor')}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs sm:text-sm font-semibold transition-all shadow-2xs hover:shadow-xs cursor-pointer active:scale-[0.98] shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4 stroke-[2.25]" />
                <span>Add New Certificates</span>
              </button>
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
                  className="w-full pl-8.5 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-[#E5DAC3] rounded-lg text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-0 focus:border-slate-400 transition-all shadow-2xs"
                />
              </div>

              <div className="flex items-center">
                <span className="text-xs font-medium text-stone-500">
                  {filteredEvents.length} {filteredEvents.length === 1 ? 'batch' : 'batches'}
                </span>
              </div>
            </div>

            {/* List of Present Records Directly On Page */}
            {loading && events.length === 0 ? (
              <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs divide-y divide-[#EFE5D0]">
                <div className="hidden md:grid dashboard-events-grid px-3.5 py-2.5 sm:py-3 text-[11px] sm:text-xs font-bold text-[#554633] uppercase tracking-wider bg-[#FBF4E2] border-b-2 border-[#E5DAC3]">
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
              <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs py-12 text-center space-y-2.5">
                <div className="w-9 h-9 rounded-full bg-[#FBF4E2] border border-[#E5DAC3] flex items-center justify-center mx-auto text-stone-500">
                  <Search className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">No Events Found</h3>
                <p className="text-xs text-stone-500 max-w-sm mx-auto">
                  {events.length === 0
                    ? 'No certificate batches have been generated yet. Open Canvas Studio to create your first batch.'
                    : 'No registered events match your search query.'}
                </p>
                {events.length === 0 && (
                  <button
                    onClick={() => router.push('/editor')}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Launch Canvas Studio</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="border-2 border-[#E5DAC3] rounded-xl overflow-hidden bg-white shadow-2xs">
                {/* Desktop Column Header */}
                <div className="hidden md:grid dashboard-events-grid px-3.5 py-2.5 sm:py-3 text-[11px] sm:text-xs font-bold text-[#554633] uppercase tracking-wider bg-[#FBF4E2] border-b-2 border-[#E5DAC3]">
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
                      key={event.eventName}
                      onClick={() => {
                        fetchEventDetails(event.eventName);
                        router.push(`/dashboard?event=${encodeURIComponent(event.eventName)}`, { scroll: false });
                      }}
                      className="group px-3.5 py-2 sm:py-2.5 hover:bg-slate-100/80 transition-colors cursor-pointer dashboard-events-grid gap-1.5 md:gap-0"
                    >
                      {/* Column 1: Event Name & Template */}
                      <div className="pr-3 min-w-0 text-left">
                        <h2 className="text-[13px] sm:text-sm font-semibold text-slate-900 group-hover:text-primary-700 transition-colors truncate">
                          {event.eventName}
                        </h2>
                        {event.templateName && (
                          <p className="text-[11px] font-medium text-stone-500 truncate mt-0.5">
                            Template: {event.templateName}
                          </p>
                        )}
                      </div>

                      {/* Column 2: Date of Issuance */}
                      <div className="text-xs sm:text-[13px] font-normal text-stone-600 whitespace-nowrap text-left md:text-right">
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
                        <div className="text-xs sm:text-[13px] whitespace-nowrap md:text-right">
                          <span className="font-bold text-slate-900 tabular-nums">{event.certificateCount}</span>
                          <span className="text-xs font-medium text-stone-500 ml-1">
                            {event.certificateCount === 1 ? 'record' : 'records'}
                          </span>
                        </div>

                        {/* Active */}
                        <div className="text-xs sm:text-[13px] whitespace-nowrap md:text-right">
                          <span className="font-bold text-emerald-700 tabular-nums">{event.activeCount}</span>
                          <span className="text-xs font-medium text-stone-500 ml-1">active</span>
                        </div>

                        {/* Revoked */}
                        <div className="text-xs sm:text-[13px] whitespace-nowrap md:text-right">
                          <span
                            className={`font-bold tabular-nums ${
                              event.revokedCount > 0 ? 'text-red-700' : 'text-stone-400'
                            }`}
                          >
                            {event.revokedCount}
                          </span>
                          <span className="text-xs font-medium text-stone-500 ml-1">revoked</span>
                        </div>
                      </div>

                      {/* Column 6: Delete Button & Arrow */}
                      <div className="flex md:contents items-center justify-end">
                        <div className="flex justify-end items-center gap-1 pr-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteEvent(event.eventName);
                            }}
                            disabled={deletingEventName === event.eventName}
                            className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={`Delete event "${event.eventName}" and all its certificates`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ChevronRight className="hidden md:block w-3.5 h-3.5 text-stone-400 group-hover:text-stone-700 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
      <DashboardContent />
    </Suspense>
  );
}
