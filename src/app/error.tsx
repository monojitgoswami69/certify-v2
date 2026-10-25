'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Route-segment error boundary (dashboard, verify, login, …). Keeps the
 * existing editor-level ErrorBoundary company: an unhandled client error
 * anywhere now shows a branded recovery screen instead of Next's default.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Something went wrong</h2>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          An unexpected error occurred while loading this page.
        </p>
        {error?.message && (
          <pre className="p-3 bg-slate-100 rounded-lg text-xs text-red-600 font-mono overflow-x-auto text-left mb-6 max-h-32">
            {error.message}
          </pre>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-primary-600/25"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
