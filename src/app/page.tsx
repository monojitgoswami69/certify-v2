'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Eye, EyeOff, X, Image as ImageIcon } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { StepCard } from '../components/sidebar/StepCard';
import { TemplateUpload } from '../components/sidebar/TemplateUpload';
import { CsvUpload } from '../components/sidebar/CsvUpload';
import { BoxCustomizer } from '../components/sidebar/BoxCustomizer';
import { CanvasEditor } from '../components/canvas/CanvasEditor';
import { GenerateButton } from '../components/sidebar/GenerateButton';
import { EmailSidebar } from '../components/email/EmailSidebar';
import { EmailPreviewPane } from '../components/email/EmailPreviewPane';
import { CsvPreviewModal } from '../components/modals/CsvPreviewModal';
import { ResizeHandle } from '../components/ui/ResizeHandle';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { initializeGoogleFonts } from '../lib/font-loader';
import { useRouter } from 'next/navigation';

function WorkspaceContent() {
  const {
    templateImage,
    templateFile,
    boxes,
    csvData,
    csvFile,
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

  const step1Complete = !!templateImage;
  const step2Complete = csvData.length > 0;
  const step3Complete = boxes.length > 0;
  const validBoxes = boxes.filter((b) => b.field);
  const step4Complete = validBoxes.length > 0;

  const step1Status = step1Complete ? 'completed' : 'active';
  const step2Status = !step1Complete ? 'pending' : step2Complete ? 'completed' : 'active';
  const step3Status = !step2Complete ? 'pending' : step3Complete ? 'completed' : 'active';
  const step4Status = !step3Complete ? 'pending' : step4Complete ? 'completed' : 'active';
  const step5Status = !step4Complete ? 'pending' : 'active';

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
        className="relative bg-white border-r border-slate-200 flex-shrink-0 flex flex-col h-full overflow-hidden"
      >
        <ResizeHandle />
        {/* Fixed Header */}
        <div className="p-4 border-b border-slate-200 bg-white flex-shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">Certify</h1>
          </div>
        </div>

        {/* Scrollable Steps Content */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Step 1 */}
          <StepCard number={1} title="Upload Template" status={step1Status}>
            {templateImage ? (
              <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-default group">
                <div className="flex items-center gap-2 min-w-0">
                  <ImageIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700 truncate">
                    {templateFile?.name || 'Template'}
                  </span>
                </div>
                <button
                  onClick={clearTemplate}
                  className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
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
              <div
                className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors group"
                onClick={() => setShowCsvPreview(true)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm text-slate-700 truncate">
                    {csvFile?.name || 'Data'} ({csvData.length} records)
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearCsvData();
                  }}
                  className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <CsvUpload />
            )}
          </StepCard>

          {/* Step 3 */}
          <StepCard number={3} title="Define Text Areas" status={step3Status}>
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Draw rectangles on the template where text should appear.
              </p>

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
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <ErrorBoundary>
      <WorkspaceContent />
    </ErrorBoundary>
  );
}
