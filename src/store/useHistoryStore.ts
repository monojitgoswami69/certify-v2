/**
 * History Store for Unified Canvas Undo / Redo
 * Snapshots both TextBox[] and QrZone[] simultaneously.
 */

import { create } from 'zustand';
import type { TextBox, QrZone } from '../types';
import { useAppStore } from './useAppStore';

export interface CanvasSnapshot {
  boxes: TextBox[];
  qrZones: QrZone[];
  // Backwards compatibility
  qrZone?: QrZone | null;
}

interface HistoryState {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];

  pushState: (boxes: TextBox[], qrZones?: QrZone[] | QrZone | null) => void;
  undo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null) => CanvasSnapshot | null;
  redo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null) => CanvasSnapshot | null;
  clearHistory: () => void;
}

function normalizeQrZones(input?: QrZone[] | QrZone | null): QrZone[] {
  if (input === undefined) {
    try {
      const current = useAppStore.getState().qrZones;
      return current ? JSON.parse(JSON.stringify(current)) : [];
    } catch {
      return [];
    }
  }
  if (!input) return [];
  if (Array.isArray(input)) return JSON.parse(JSON.stringify(input));
  return [JSON.parse(JSON.stringify(input))];
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  pushState: (boxes: TextBox[], qrZones?: QrZone[] | QrZone | null) => {
    const normalized = normalizeQrZones(qrZones);
    const snapshot: CanvasSnapshot = {
      boxes: JSON.parse(JSON.stringify(boxes)),
      qrZones: normalized,
      qrZone: normalized[0] || null,
    };
    set((state) => ({
      past: [...state.past.slice(-25), snapshot],
      future: [],
    }));
  },

  undo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null) => {
    const { past, future } = get();
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const normalized = normalizeQrZones(currentQrZones);

    const currentSnapshot: CanvasSnapshot = {
      boxes: JSON.parse(JSON.stringify(currentBoxes)),
      qrZones: normalized,
      qrZone: normalized[0] || null,
    };

    set({
      past: newPast,
      future: [currentSnapshot, ...future],
    });

    return previous;
  },

  redo: (currentBoxes: TextBox[], currentQrZones?: QrZone[] | QrZone | null) => {
    const { past, future } = get();
    if (future.length === 0) return null;

    const next = future[0];
    const newFuture = future.slice(1);
    const normalized = normalizeQrZones(currentQrZones);

    const currentSnapshot: CanvasSnapshot = {
      boxes: JSON.parse(JSON.stringify(currentBoxes)),
      qrZones: normalized,
      qrZone: normalized[0] || null,
    };

    set({
      past: [...past, currentSnapshot],
      future: newFuture,
    });

    return next;
  },

  clearHistory: () => set({ past: [], future: [] }),
}));
