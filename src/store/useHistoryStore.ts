/**
 * History Store for Canvas Undo / Redo
 */

import { create } from 'zustand';
import type { TextBox } from '../types';

interface HistoryState {
  past: TextBox[][];
  future: TextBox[][];

  pushState: (boxes: TextBox[]) => void;
  undo: (currentBoxes: TextBox[]) => TextBox[] | null;
  redo: (currentBoxes: TextBox[]) => TextBox[] | null;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  pushState: (boxes: TextBox[]) => {
    set((state) => ({
      past: [...state.past.slice(-20), JSON.parse(JSON.stringify(boxes))],
      future: [],
    }));
  },

  undo: (currentBoxes: TextBox[]) => {
    const { past, future } = get();
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    set({
      past: newPast,
      future: [JSON.parse(JSON.stringify(currentBoxes)), ...future],
    });

    return previous;
  },

  redo: (currentBoxes: TextBox[]) => {
    const { past, future } = get();
    if (future.length === 0) return null;

    const next = future[0];
    const newFuture = future.slice(1);

    set({
      past: [...past, JSON.parse(JSON.stringify(currentBoxes))],
      future: newFuture,
    });

    return next;
  },

  clearHistory: () => set({ past: [], future: [] }),
}));
