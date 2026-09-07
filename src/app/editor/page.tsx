'use client';

import { useEffect, useState, Suspense } from 'react';
import { FileSpreadsheet, X, Image as ImageIcon, CalendarDays } from 'lucide-react';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import { SidebarHeader } from '../../components/sidebar/SidebarHeader';
import { StepCard } from '../../components/sidebar/StepCard';
import { TemplateUpload } from '../../components/sidebar/TemplateUpload';
import { CsvUpload } from '../../components/sidebar/CsvUpload';
import { BoxCustomizer } from '../../components/sidebar/BoxCustomizer';
import { QrZoneCard } from '../../components/sidebar/QrZoneCard';
import { CanvasEditor } from '../../components/canvas/CanvasEditor';
import { GenerateButton } from '../../components/sidebar/GenerateButton';
import { EmailSidebar } from '../../components/email/EmailSidebar';
import { EmailPreviewPane } from '../../components/email/EmailPreviewPane';
import { CsvPreviewModal } from '../../components/modals/CsvPreviewModal';
import { ResizeHandle } from '../../components/ui/ResizeHandle';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { useAuthStore } from '../../store/useAuthStore';
import { initializeGoogleFonts } from '../../lib/font-loader';
import { sanitizeFilename, buildVirtualCsvFile } from '../../lib/utils';
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
    viewMode,
    error,
    previewEnabled,
    sidebarWidth,
    setFonts,
    setPreviewEnabled,
    clearTemplate,
    clearCsvData,
  } = useAppStore();

  const { isAuthenticated, isLoading, initialize, token } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateIdParam = searchParams.get('templateId');
  const eventParam = searchParams.get('event');
  const [showCsvPreview, setShowCsvPreview] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    initializeGoogleFonts().then((fonts) => {
      setFonts(fonts);
    });
  }, [setFonts]);

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
    const activeToken =
      token ||
      (typeof window !== 'undefined'
        ? localStorage.getItem('credify_auth_token') || sessionStorage.getItem('credify_session_token')
        : null);
    if (!activeToken) return;

    const loadWorkspaceFromQuery = async () => {
      try {
        let tpl: { id?: string; name: string; imageData: string; layoutConfig?: any } | null = null;

        // If loading a new event and current event is different, reset first
        if (eventParam && useAppStore.getState().eventName !== eventParam) {
          useAppStore.getState().reset();
          useHistoryStore.getState().clearHistory();
        }

        // 1. If event is specified, query dashboard event details (includes participants & template)
        if (eventParam) {
          const res = await fetch(`/api/dashboard?event=${encodeURIComponent(eventParam)}`, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });

          if (res.ok) {
            const data = await res.json();
            if (isCancelled) return;

            // Auto-populate CSV data from event participants if not already matching this event
            if (
              data.participants &&
              data.participants.length > 0 &&
              (useAppStore.getState().csvData.length === 0 || useAppStore.getState().eventName !== eventParam)
            ) {
              const { file: csvFile, headers, rows } = buildVirtualCsvFile(eventParam, data.participants);
              useAppStore.getState().setCsvData(csvFile, headers, rows);
            }

            if (data.template) {
              tpl = data.template;
            }

            useAppStore.getState().setEventName(eventParam);
          }
        }

        // 2. If template was not resolved via event, fallback to templateId query
        if (!tpl && templateIdParam) {
          const tplRes = await fetch(`/api/templates/${templateIdParam}`, {
            headers: { Authorization: `Bearer ${activeToken}` },
          });
          if (tplRes.ok) {
            const tplData = await tplRes.json();
            tpl = tplData.template;
          }
        }

        // 3. Apply template graphic and layout configuration if not already loaded for this event
        if (
          tpl?.imageData &&
          (!useAppStore.getState().templateImage || useAppStore.getState().eventName !== eventParam) &&
          !isCancelled
        ) {
          const blobRes = await fetch(tpl.imageData);
          const blob = await blobRes.blob();
          const tplFilename = `${sanitizeFilename(eventParam || tpl.name)}.png`;
          const file = new File([blob], tplFilename, { type: 'image/png' });

          const img = new Image();
          img.onload = () => {
            if (isCancelled) return;
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
            if (eventParam) {
              store.setEventName(eventParam);
            }
          };
          img.src = tpl.imageData;
        }
      } catch (err) {
        console.warn('[Auto-load workspace from query error]:', err);
      }
    };

    loadWorkspaceFromQuery();

    return () => {
      isCancelled = true;
    };
  }, [templateIdParam, eventParam, isAuthenticated, token]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-sm font-medium">Initializing workspace...</p>
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
  const step4Complete = validBoxes.length > 0;

  const step1Status = step1Complete ? 'completed' : 'active';
  const step2Status = !step1Complete ? 'pending' : step2Complete ? 'completed' : 'active';
  const step3Status = !step1Complete ? 'pending' : step3Complete ? 'completed' : 'active';
  const step4Status = !step1Complete || boxes.length === 0 ? 'pending' : step4Complete ? 'completed' : 'active';
  const step5Status = !step1Complete || !step2Complete || (!step4Complete && qrZones.length === 0) ? 'pending' : 'active';

  if (viewMode === 'email') {
    return (
      <div className="h-screen flex flex-col bg-slate-50">
        <main className="flex-1 flex overflow-hidden">
          <EmailSidebar />
          <EmailPreviewPane />
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      <aside
        style={{ width: `${sidebarWidth}px` }}
        className="relative bg-white border-r border-slate-500/80 flex-shrink-0 flex flex-col h-full"
      >
        <ResizeHandle />
        <SidebarHeader />

        {/* Scrollable Steps Content */}
        <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto">
          {/* Step 1 */}
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
              <TemplateUpload />
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
              <CsvUpload />
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
          </StepCard>

          {/* Step 5 */}
          <StepCard number={5} title="Generate & Deliver" status={step5Status}>
            <GenerateButton />
            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}
          </StepCard>
        </div>
      </aside>

      <CanvasEditor />

      <CsvPreviewModal isOpen={showCsvPreview} onClose={() => setShowCsvPreview(false)} />
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
