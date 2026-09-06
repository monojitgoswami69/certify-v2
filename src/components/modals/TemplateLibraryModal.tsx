'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  LayoutTemplate,
  Trash2,
  Clock,
  ArrowRight,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { TextBox, QrZone } from '../../types';

interface TemplateSummary {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  layoutConfig: {
    boxes?: TextBox[];
    qrZones?: QrZone[];
    defaultFont?: string;
    defaultFontSize?: number;
    defaultFontColor?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface TemplateLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoaded?: (templateName: string) => void;
}

export function TemplateLibraryModal({ isOpen, onClose, onLoaded }: TemplateLibraryModalProps) {
  const { setTemplate, setBoxes, setQrZones, setDefaultFont, setDefaultFontSize, setDefaultFontColor } = useAppStore();
  const { token } = useAuthStore();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTemplates = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/templates', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to fetch templates');
      }

      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading templates');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen, fetchTemplates]);

  if (!isOpen) return null;

  // Load a selected template into the workspace
  const handleLoadTemplate = async (templateId: string) => {
    if (!token) return;
    setLoadingId(templateId);
    setError(null);

    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to load template');
      }

      const { template } = await res.json();
      if (!template?.imageData) {
        throw new Error('Template graphic data is missing');
      }

      // Convert Base64 data URL to Image and File
      const blobRes = await fetch(template.imageData);
      const blob = await blobRes.blob();
      const filename = `${template.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const info = `${file.name} (${img.width}×${img.height})`;
          setTemplate(file, img, info);

          // Restore layout configuration
          const config = template.layoutConfig || {};
          if (Array.isArray(config.boxes)) {
            setBoxes(config.boxes);
          }
          if (Array.isArray(config.qrZones)) {
            setQrZones(config.qrZones);
          }
          if (config.defaultFont) setDefaultFont(config.defaultFont);
          if (config.defaultFontSize) setDefaultFontSize(config.defaultFontSize);
          if (config.defaultFontColor) setDefaultFontColor(config.defaultFontColor);

          resolve();
        };
        img.onerror = () => reject(new Error('Failed to decode template image'));
        img.src = template.imageData;
      });

      if (onLoaded) {
        onLoaded(template.name);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoadingId(null);
    }
  };

  // Delete a saved template
  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    if (!token) return;
    const confirmed = window.confirm(`Are you sure you want to delete template "${templateName}"?`);
    if (!confirmed) return;

    setDeletingId(templateId);

    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete template');
      }

      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 border border-primary-200 flex items-center justify-center font-bold shadow-2xs">
              <LayoutTemplate className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Saved Templates Library</h2>
              <p className="text-[11px] text-slate-400">Reusable certificate layouts stored in database</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-100 bg-white flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved templates by name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
            />
          </div>
          <button
            onClick={fetchTemplates}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
            title="Refresh templates"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Template List Container */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <LayoutTemplate className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">No Saved Templates Found</h3>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                {templates.length === 0
                  ? 'You haven’t saved any templates yet. Upload a certificate, draw fields, and click "Save Template" to store it here.'
                  : 'No saved templates match your search.'}
              </p>
            </div>
          ) : (
            filteredTemplates.map((t) => {
              const boxCount = t.layoutConfig?.boxes?.length || 0;
              const qrCount = t.layoutConfig?.qrZones?.length || 0;
              const isCurrentLoading = loadingId === t.id;
              const isDeleting = deletingId === t.id;

              return (
                <div
                  key={t.id}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-900">{t.name}</h3>
                      {t.width && t.height && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
                          {t.width}×{t.height}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Saved: {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                      <span>•</span>
                      <span className="text-slate-600 font-medium">{boxCount} text fields</span>
                      <span>•</span>
                      <span className="text-slate-600 font-medium">{qrCount} QR zones</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                      onClick={() => handleDeleteTemplate(t.id, t.name)}
                      disabled={isDeleting || isCurrentLoading}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-200 disabled:opacity-50"
                      title="Delete template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleLoadTemplate(t.id)}
                      disabled={isCurrentLoading || isDeleting}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer active:scale-[0.99] disabled:opacity-50"
                    >
                      {isCurrentLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5" />
                      )}
                      <span>{isCurrentLoading ? 'Loading...' : 'Load Template'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
