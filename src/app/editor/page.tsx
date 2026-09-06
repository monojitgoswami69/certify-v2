'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Eye, EyeOff, X, Image as ImageIcon, CalendarDays, Save, LayoutTemplate } from 'lucide-react';
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
import { SaveTemplateModal } from '../../components/modals/SaveTemplateModal';
import { TemplateLibraryModal } from '../../components/modals/TemplateLibraryModal';
import { ResizeHandle } from '../../components/ui/ResizeHandle';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { initializeGoogleFonts } from '../../lib/font-loader';
import { useRouter } from 'next/navigation';

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

  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const router = useRouter();
  const [showCsvPreview, setShowCsvPreview] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);

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
  const step3Status = !step1Complete || !step2Complete ? 'pending' : step3Complete ? 'completed' : 'active';
  const step4Status = !step1Complete || !step2Complete || !step3Complete ? 'pending' : step4Complete ? 'completed' : 'active';
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
        className="relative bg-white border-r-4 border-slate-300 flex-shrink-0 flex flex-col h-full"
      >
        <ResizeHandle />
        <SidebarHeader />

        {/* Scrollable Steps Content */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Step 1 */}
          <StepCard number={1} title="Upload Template" status={step1Status}>
            {templateImage ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 shadow-sm rounded-xl cursor-default group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 bg-primary-50 text-primary-600 rounded-lg flex-shrink-0 border border-primary-100">
                      <ImageIcon className="w-4 h-4" />
                    </div>
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

                {/* Save to DB and Switch from Library buttons */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowSaveTemplateModal(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                    title="Save current background graphic and box positions to database"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Template</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLibraryModal(true)}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer shadow-2xs"
                    title="Load a saved template from database"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5 text-slate-500" />
                    <span>Saved</span>
                  </button>
                </div>
              </div>
            ) : (
              <TemplateUpload />
            )}
          </StepCard>

          {/* Step 2 */}
          <StepCard number={2} title="Import Data" status={step2Status}>
            {csvData.length > 0 ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-white border border-slate-200 shadow-sm rounded-xl group">
                  <div
                    onClick={() => setShowCsvPreview(true)}
                    className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                    title="Click to view full CSV data table"
                  >
                    <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg flex-shrink-0 border border-emerald-100 group-hover:bg-emerald-100 transition-colors">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-semibold text-slate-800 truncate group-hover:text-emerald-700 transition-colors">
                      {csvFile?.name || 'Data'} ({csvData.length} records)
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearCsvData();
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                    title="Remove CSV data"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Event Name Card */}
                <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 text-primary-600" />
                      Event Name
                    </span>
                  </label>
                  <input
                    type="text"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="e.g. Annual Tech Symposium 2026"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 font-medium text-slate-800 placeholder:text-slate-400 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 leading-tight">
                    All certificate records and verification IDs in this batch will be saved under this event name.
                  </p>
                </div>
              </div>
            ) : (
              <CsvUpload />
            )}
          </StepCard>

          {/* Step 3 */}
          <StepCard number={3} title="Text Areas & QR Codes" status={step3Status}>
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Draw rectangles for text fields, or click below to place verification QR codes.
              </p>

              <QrZoneCard />

              <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-600">Preview Data</span>
                <button
                  onClick={() => setPreviewEnabled(!previewEnabled)}
                  className={`p-1.5 rounded-md transition-colors ${
                    previewEnabled ? 'bg-primary-100 text-primary-600' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {previewEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
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
      <SaveTemplateModal
        isOpen={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
      />
      <TemplateLibraryModal
        isOpen={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
      />
    </div>
  );
}

export default function CertificateStudioPage() {
  return (
    <ErrorBoundary>
      <WorkspaceContent />
    </ErrorBoundary>
  );
}
