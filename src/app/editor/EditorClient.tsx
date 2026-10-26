'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { FileSpreadsheet, X, Image as ImageIcon, CalendarDays, Monitor, Sparkles, Table2 } from 'lucide-react';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { SidebarHeader } from '../../components/sidebar/SidebarHeader';
import { StepCard } from '../../components/sidebar/StepCard';
import { TemplateUpload } from '../../components/sidebar/TemplateUpload';
import { StarterGalleryModal } from '../../components/modals/StarterGalleryModal';
import { CsvDrafterModal } from '../../components/modals/CsvDrafterModal';
import { AddRecipientForm } from '../../components/sidebar/AddRecipientForm';
import { CsvUpload } from '../../components/sidebar/CsvUpload';
import { BoxCustomizer } from '../../components/sidebar/BoxCustomizer';
import { ImagesCard } from '../../components/sidebar/ImagesCard';
import { QrZoneCard } from '../../components/sidebar/QrZoneCard';
import { CanvasEditor } from '../../components/canvas/CanvasEditor';
import { GenerateButton } from '../../components/sidebar/GenerateButton';
import { SpotCheckButton } from '../../components/sidebar/SpotCheckButton';
import { EmailSidebar } from '../../components/email/EmailSidebar';
import { EmailPreviewPane } from '../../components/email/EmailPreviewPane';
import { CsvPreviewModal } from '../../components/modals/CsvPreviewModal';
import { ResizeHandle } from '../../components/ui/ResizeHandle';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { useAuthStore } from '../../store/useAuthStore';
import { loadWorkspace, isWorkspaceLoadedFor } from '../../lib/workspace-loader';
import {
  fetchWorkspaceDraft,
  saveWorkspaceDraft,
  deleteWorkspaceDraft,
  type DraftState,
} from '../../lib/draft-autosave';
import { getAuthToken } from '../../lib/api-client';
import { imageSourceToBlob } from '../../lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';

function WorkspaceContent() {
  const {
    templateImage,
    templateFile,
    boxes,
    qrZones,
    csvData,
    csvFile,
    eventName,
    setEventName,
    setCsvData,
    setBoxes,
    setTemplate,
    viewMode,
    error,
    previewEnabled,
    sidebarWidth,
    setPreviewEnabled,
    clearTemplate,
    clearCsvData,
    images,
    emailSettings,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    csvHeaders,
    setEmailSettings,
    setDefaultFont,
    setDefaultFontSize,
    setDefaultFontColor,
    setQrZones,
    setImages,
  } = useAppStore();

  const { isAuthenticated, isLoading, initialize, token } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateIdParam = searchParams.get('templateId');
  const eventParam = searchParams.get('event');
  const [showCsvPreview, setShowCsvPreview] = useState(false);
  const [showStarterGallery, setShowStarterGallery] = useState(false);
  const [showCsvDrafter, setShowCsvDrafter] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [dismissNarrowWarning, setDismissNarrowWarning] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrowScreen(typeof window !== 'undefined' && window.innerWidth < 768);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // -----------------------------------------------------------------
  // Draft workspaces: debounced server autosave + one-click recovery, so a
  // closed tab loses nothing. Skipped while hydrating from a URL (event /
  // templateId) or while the canvas is empty-and-clean.
  // -----------------------------------------------------------------
  const [draftRecovery, setDraftRecovery] = useState<DraftState | null>(null);
  const draftCheckedRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedFromEvent = Boolean(eventParam || templateIdParam);

  useEffect(() => {
    if (!isAuthenticated || isLoading || hydratedFromEvent || draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    const state = useAppStore.getState();
    const clean =
      !state.templateImage && state.csvData.length === 0 && state.boxes.length === 0 && !state.eventName;
    if (!clean) return;
    void fetchWorkspaceDraft().then((draft) => {
      if (draft && (draft.templateRef || draft.csvRows.length > 0 || draft.boxes.length > 0 || draft.eventName)) {
        setDraftRecovery(draft);
      }
    });
  }, [isAuthenticated, isLoading, hydratedFromEvent]);

  useEffect(() => {
    if (!isAuthenticated || isLoading || hydratedFromEvent || !templateImage) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      void saveWorkspaceDraft({
        eventName,
        csvHeaders,
        csvRows: csvData.slice(0, 2000),
        csvFileName: csvFile?.name ?? null,
        boxes,
        qrZones,
        images,
        emailSettings,
        defaultFont: defaultFont ?? undefined,
        defaultFontSize: defaultFontSize ?? undefined,
        defaultFontColor: defaultFontColor ?? undefined,
        templateRef: templateFile
          ? { fileName: templateFile.name, width: templateImage.naturalWidth, height: templateImage.naturalHeight }
          : null,
      });
    }, 2500);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    isAuthenticated,
    isLoading,
    hydratedFromEvent,
    eventName,
    csvData,
    csvHeaders,
    csvFile,
    boxes,
    qrZones,
    images,
    emailSettings,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    templateImage,
    templateFile,
  ]);

  const recoverDraft = useCallback(async () => {
    const draft = draftRecovery;
    if (!draft) return;
    setDraftRecovery(null);
    try {
      setEventName(draft.eventName || '');
      if (draft.csvRows.length > 0 && draft.csvHeaders.length > 0) {
        const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
        const csvContent = [
          draft.csvHeaders.map(esc).join(','),
          ...draft.csvRows.map((r) => draft.csvHeaders.map((h) => esc(r[h] ?? '')).join(',')),
        ].join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const file = new File([blob], draft.csvFileName || 'recovered-roster.csv', { type: 'text/csv' });
        setCsvData(file, draft.csvHeaders, draft.csvRows);
      }
      setBoxes(draft.boxes || []);
      setQrZones(draft.qrZones || []);
      setImages(draft.images || []);
      if (draft.emailSettings) setEmailSettings(draft.emailSettings);
      if (draft.defaultFont) setDefaultFont(draft.defaultFont);
      if (draft.defaultFontSize) setDefaultFontSize(draft.defaultFontSize);
      if (draft.defaultFontColor) setDefaultFontColor(draft.defaultFontColor);

      // Best-effort template restore: match a saved template by the original file name.
      if (draft.templateRef) {
        const base = draft.templateRef.fileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
        const tokenNow = token || getAuthToken();
        const res = await fetch('/api/templates', {
          credentials: 'same-origin',
          headers: tokenNow ? { Authorization: `Bearer ${tokenNow}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const match = (data.templates ?? []).find(
            (t: { name: string }) => t.name.trim().toLowerCase() === base
          );
          if (match) {
            const full = await fetch(`/api/templates/${match.id}`, {
              credentials: 'same-origin',
              headers: tokenNow ? { Authorization: `Bearer ${tokenNow}` } : {},
            });
            if (full.ok) {
              const { template } = await full.json();
              if (template?.imageData) {
                const blob = await imageSourceToBlob(template.imageData);
                const file = new File([blob], template.name + '.png', { type: blob.type || 'image/png' });
                const img = document.createElement('img');
                await new Promise<void>((resolve, reject) => {
                  img.onload = () => resolve();
                  img.onerror = () => reject(new Error('decode failed'));
                  img.src = template.imageData;
                });
                setTemplate(file, img, `${template.name} (recovered)`);
              }
            }
          }
        }
      }
      void deleteWorkspaceDraft();
    } catch (err) {
      console.warn('[Draft recovery] failed:', err);
    }
  }, [
    draftRecovery,
    setEventName,
    setCsvData,
    setBoxes,
    setQrZones,
    setImages,
    setEmailSettings,
    setDefaultFont,
    setDefaultFontSize,
    setDefaultFontColor,
    setTemplate,
    token,
  ]);

  // Fresh Studio entry: If no event or templateId query param is present, ensure workspace state is clean
  useEffect(() => {
    if (!eventParam && !templateIdParam) {
      const state = useAppStore.getState();
      if (state.templateImage || state.csvData.length > 0 || state.boxes.length > 0 || state.eventName) {
        state.reset();
        useHistoryStore.getState().clearHistory();
      }
    }
  }, [eventParam, templateIdParam]);

  // Pre-load template, layout, and CSV dataset if event or templateId query param is supplied
  useEffect(() => {
    if ((!eventParam && !templateIdParam) || !isAuthenticated) return;

    let isCancelled = false;
    const activeToken = token || getAuthToken();
    if (!activeToken) return;

    // Already hydrated (e.g. by the dashboard's "Open in Studio" before navigating)
    if (eventParam && isWorkspaceLoadedFor(eventParam)) {
      setIsHydrating(false);
      return;
    }

    setIsHydrating(true);
    loadWorkspace({
      eventName: eventParam,
      templateId: templateIdParam,
      token: activeToken,
      shouldApply: () => !isCancelled,
    })
      .catch((err) => {
        console.warn('[Auto-load workspace from query error]:', err);
      })
      .finally(() => {
        if (!isCancelled) setIsHydrating(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [templateIdParam, eventParam, isAuthenticated, token]);

  if ((isLoading && !isAuthenticated) || isHydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 animate-smooth-fade">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-sm font-medium">
            {isHydrating ? 'Loading event workspace...' : 'Initializing workspace...'}
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const step1Complete = Boolean(templateImage);
  const step2Complete = csvData.length > 0;
  const step3Complete = boxes.length > 0 || qrZones.length > 0;
  const validBoxes = boxes.filter((b) => b.field);
  const step4Complete = validBoxes.length > 0 || qrZones.length > 0;

  const step1Status = step1Complete ? 'completed' : 'active';
  const step2Status = !step1Complete ? 'pending' : step2Complete ? 'completed' : 'active';
  const step3Status = !step1Complete ? 'pending' : step3Complete ? 'completed' : 'active';
  const step4Status = !step1Complete || (boxes.length === 0 && qrZones.length === 0) ? 'pending' : step4Complete ? 'completed' : 'active';
  const step5Status = !step1Complete || !step2Complete || (!step4Complete && qrZones.length === 0) ? 'pending' : 'active';

  if (viewMode === 'email') {
    return (
      <div className="animate-fade-in h-screen h-dvh flex flex-col bg-slate-50">
        <main className="flex-1 flex overflow-hidden">
          <EmailSidebar />
          <EmailPreviewPane />
        </main>
      </div>
    );
  }

  return (
    <div className="animate-fade-in h-screen h-dvh flex bg-slate-50 overflow-hidden">
      <aside
        style={{ width: `min(${sidebarWidth}px, 100vw)` }}
        className="relative bg-white border-r border-slate-500/80 flex-shrink-0 flex flex-col h-full w-full md:w-auto max-w-full md:max-w-[75vw]"
      >
        <ResizeHandle />
        <SidebarHeader />

        {/* Scrollable Steps Content */}
        <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto">
          {/* Step 1 */}
          {draftRecovery && (
            <div className="mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50/80 text-xs font-quicksand">
              <p className="font-semibold text-amber-800">
                Recover your previous session?
              </p>
              <p className="text-amber-700 mt-0.5">
                A draft from {new Date(draftRecovery.savedAt).toLocaleString()} was found — layout, roster
                {draftRecovery.templateRef ? ', and template' : ''} can be restored.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void recoverDraft()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Recover session
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteWorkspaceDraft();
                    setDraftRecovery(null);
                  }}
                  className="px-3 py-1.5 text-stone-600 border border-stone-200 rounded-lg text-[11px] font-semibold hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          <StepCard number={1} title="Upload Template" status={step1Status}>
            {templateImage ? (
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 shadow-xs rounded-xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ImageIcon className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {templateFile?.name || 'Template'}
                  </span>
                </div>
                <button
                  onClick={clearTemplate}
                  className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                  title="Remove template"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <TemplateUpload />
                <button
                  type="button"
                  onClick={() => setShowStarterGallery(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-semibold text-stone-700 bg-white border border-stone-200 rounded-lg hover:border-stone-400 hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary-600" />
                  Browse starter templates
                </button>
              </div>
            )}
          </StepCard>

          {/* Step 2 */}
          <StepCard number={2} title="Import Data" status={step2Status}>
            {csvData.length > 0 ? (
              <div className="space-y-3">
                {/* CSV File */}
                <div
                  onClick={() => setShowCsvPreview(true)}
                  className="flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 shadow-xs rounded-xl cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/10 transition-all group"
                  title="Click to view full CSV data table"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {csvFile?.name || 'Data'} ({csvData.length} records)
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearCsvData();
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
                    title="Remove CSV data"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Event Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                    Event Name
                  </label>
                  <input
                    type="text"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="e.g. Annual Tech Symposium 2026"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-0 focus:border-slate-400 font-medium text-slate-800 placeholder:text-slate-400 transition-colors"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <CsvUpload />
                <button
                  type="button"
                  onClick={() => setShowCsvDrafter(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-semibold text-stone-700 bg-white border border-stone-200 rounded-lg hover:border-stone-400 hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  <Table2 className="w-3.5 h-3.5 text-primary-600" />
                  Draft a CSV manually
                </button>
              </div>
            )}
            {csvData.length > 0 && (
              <AddRecipientForm />
            )}
          </StepCard>

          {/* Step 3 */}
          <StepCard number={3} title="Text Areas & QR Codes" status={step3Status}>
            <div className="space-y-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                Click and drag on the certificate to draw text fields.
              </p>

              <QrZoneCard />

              <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-sm font-medium text-slate-700">Preview Data</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={previewEnabled}
                  onClick={() => setPreviewEnabled(!previewEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-0 ${
                    previewEnabled ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span className="sr-only">Toggle preview data</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      previewEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </StepCard>

          {/* Step 4 */}
          <StepCard number={4} title="Customize Box" status={step4Status}>
            <BoxCustomizer />
          <ImagesCard />
          </StepCard>

          {/* Step 5 */}
          <StepCard number={5} title="Generate & Deliver" status={step5Status}>
            <GenerateButton />
            <SpotCheckButton />
            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}
          </StepCard>
        </div>
      </aside>

      <CanvasEditor />

      <StarterGalleryModal open={showStarterGallery} onClose={() => setShowStarterGallery(false)} />
      <CsvDrafterModal open={showCsvDrafter} onClose={() => setShowCsvDrafter(false)} />
      <CsvPreviewModal isOpen={showCsvPreview} onClose={() => setShowCsvPreview(false)} />

      {/* Small Screen / Mobile Warning Modal */}
      {isNarrowScreen && !dismissNarrowWarning && (
        <div className="fixed inset-0 z-[999] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto shadow-sm">
              <Monitor className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Widescreen Display Recommended</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
                Canvas Studio is designed for desktop, laptop, and widescreen tablet displays (such as an iPad or Surface in landscape) to inspect certificate dimensions and place elements accurately.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                Return to Dashboard
              </button>
              <button
                onClick={() => setDismissNarrowWarning(true)}
                className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CertificateStudioPage() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-500 text-sm font-medium">Initializing workspace...</p>
            </div>
          </div>
        }
      >
        <WorkspaceContent />
      </Suspense>
    </ErrorBoundary>
  );
}
