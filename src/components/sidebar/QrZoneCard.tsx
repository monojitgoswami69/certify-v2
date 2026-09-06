'use client';

import { QrCode, Trash2, Plus, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useHistoryStore } from '../../store/useHistoryStore';

/**
 * Step-3 card for adding and managing QR verification zones on the certificate.
 * Clicking "Add QR Code" enables click-to-place mode on the canvas.
 */
export function QrZoneCard() {
  const {
    templateImage,
    boxes,
    qrZones,
    activeQrId,
    isPlacingQr,
    csvData,
    setIsPlacingQr,
    setActiveQrId,
    deleteQrZone,
  } = useAppStore();

  const { pushState } = useHistoryStore();

  if (!templateImage) return null;

  const isCsvUploaded = csvData.length > 0;

  return (
    <div className="space-y-2">
      {/* Add QR Button / Active Placement Status */}
      {isPlacingQr ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-300 rounded-lg text-xs font-semibold text-violet-700 animate-pulse">
            <QrCode className="w-4 h-4 text-violet-600 flex-shrink-0" />
            <span className="truncate">Click on certificate to place QR</span>
          </div>
          <button
            onClick={() => setIsPlacingQr(false)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
            title="Cancel placement"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => isCsvUploaded && setIsPlacingQr(true)}
          disabled={!isCsvUploaded}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-violet-300 bg-violet-50/50 text-violet-700 rounded-lg text-sm font-medium hover:bg-violet-100/70 hover:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-violet-50/50 disabled:hover:border-violet-300 transition-all active:scale-[0.99]"
          title={!isCsvUploaded ? 'Upload a CSV file first in Step 2 to add QR codes' : 'Add QR Code'}
        >
          <Plus className="w-4 h-4" />
          <span>Add QR Code</span>
        </button>
      )}

      {/* List of Placed QR Zones */}
      {qrZones.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {qrZones.map((zone, index) => {
            const isActive = activeQrId === zone.id;
            return (
              <div
                key={zone.id}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-violet-50 border-violet-300 ring-1 ring-violet-300 text-violet-900 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800 shadow-sm'
                }`}
                onClick={() => setActiveQrId(zone.id)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`p-1.5 rounded-lg flex-shrink-0 border ${
                      isActive
                        ? 'bg-violet-100 text-violet-700 border-violet-200'
                        : 'bg-slate-50 text-slate-600 border-slate-100'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold truncate text-slate-800">
                    QR Code {qrZones.length > 1 ? index + 1 : ''} ({Math.round(zone.size)}×{Math.round(zone.size)} px)
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    pushState(boxes, qrZones);
                    deleteQrZone(zone.id);
                  }}
                  className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                  title="Delete QR Code"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
