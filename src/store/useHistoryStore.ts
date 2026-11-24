/**
 * History Store for Unified Canvas Undo / Redo
 * Snapshots both TextBox[] and QrZone[] simultaneously.
 */

import { create } from 'zustand';
import type { TextBox, QrZone, ImageElement } from '../types';
import { useAppStore } from './useAppStore';

export interface CanvasSnapshot {
  boxes: TextBox[];
  qrZones: QrZone[];
  images: ImageElement[];
  // Backwards compatibility
  qrZone?: QrZone | null;
}

interface HistoryState {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];

  pushState: (boxes: TextBox[], qrZones?: QrZone[] | QrZone | null, images?: ImageElement[] | null) => void;
  undo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null, currentImages?: ImageElement[] | null) => CanvasSnapshot | null;
  redo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null, currentImages?: ImageElement[] | null) => CanvasSnapshot | null;
  clearHistory: () => void;
}

function snapshotCanvas(
  boxes: TextBox[],
  qrZones?: QrZone[] | QrZone | null,
  images?: ImageElement[] | null
): CanvasSnapshot {
  const current = useAppStore.getState();
  const zones = qrZones === undefined ? current.qrZones
    : Array.isArray(qrZones) ? qrZones : qrZones ? [qrZones] : [];
  const snapshotZones = zones.map((zone) => ({
    ...zone,
    style: zone.style ? { ...zone.style } : undefined,
  }));
  // Asset data URLs are immutable strings. Keep their references across history entries.
  return {
    boxes: boxes.map((box) => ({ ...box })),
    qrZones: snapshotZones,
    images: (images === undefined ? current.images : images ?? []).map((image) => ({ ...image })),
    qrZone: snapshotZones[0] ?? null,
  };
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  pushState: (boxes: TextBox[], qrZones?: QrZone[] | QrZone | null, images?: ImageElement[] | null) => {
    const snapshot = snapshotCanvas(boxes, qrZones, images);
    set((state) => ({
      past: [...state.past.slice(-25), snapshot],
      future: [],
    }));
  },

  undo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null, currentImages?: ImageElement[] | null) => {
    const { past, future } = get();
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const currentSnapshot = snapshotCanvas(currentBoxes, currentQrZones, currentImages);

    set({
      past: newPast,
      future: [currentSnapshot, ...future],
    });

    return previous;
  },

  redo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null, currentImages?: ImageElement[] | null) => {
    const { past, future } = get();
    if (future.length === 0) return null;

    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot = snapshotCanvas(currentBoxes, currentQrZones, currentImages);

    set({
      past: [...past, currentSnapshot],
      future: newFuture,
    });

    return next;
  },

  clearHistory: () => set({ past: [], future: [] }),
}));

// Snapshots hold coordinates for a specific template; undoing them onto a different one corrupts the layout
useAppStore.subscribe((state, prev) => {
  if (state.templateImage !== prev.templateImage) {
    useHistoryStore.getState().clearHistory();
  }
});
