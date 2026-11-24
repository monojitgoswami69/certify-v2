/**
 * Server-side draft workspaces (client helper).
 *
 * Debounced autosave of the editor session (layout, roster, email copy,
 * event name) to the account's draft row, plus recovery. The template
 * artwork is not stored in the draft — drafts reference it by file name and
 * the matching saved template is restored on recovery (best effort).
 */
import { apiFetch } from './api-client';
import type { TextBox, QrZone, ImageElement, EmailSettings } from '../types';

export interface DraftState {
  savedAt: string;
  eventName: string;
  eventLabel?: string;
  csvHeaders: string[];
  csvRows: Array<Record<string, string>>;
  csvFileName: string | null;
  boxes: TextBox[];
  qrZones: QrZone[];
  images: ImageElement[];
  emailSettings: EmailSettings;
  defaultFont?: string;
  defaultFontSize?: number;
  defaultFontColor?: string;
  templateRef: { fileName: string; width: number; height: number } | null;
}

interface DraftResponse {
  draft: { state: DraftState; updatedAt: string } | null;
}

export function isDraftState(value: unknown): value is DraftState {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<DraftState>;
  return typeof draft.savedAt === 'string'
    && Number.isFinite(Date.parse(draft.savedAt))
    && typeof draft.eventName === 'string'
    && Array.isArray(draft.csvHeaders)
    && draft.csvHeaders.every((header) => typeof header === 'string')
    && Array.isArray(draft.csvRows)
    && draft.csvRows.every((row) => row && typeof row === 'object' && !Array.isArray(row))
    && Array.isArray(draft.boxes)
    && Array.isArray(draft.qrZones)
    && Array.isArray(draft.images)
    && (!draft.templateRef || typeof draft.templateRef.fileName === 'string');
}

export async function fetchWorkspaceDraft(): Promise<DraftState | null> {
  const response = await apiFetch('/api/workspace-draft', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the workspace draft.');
  const data = (await response.json()) as DraftResponse;
  return isDraftState(data.draft?.state) ? data.draft.state : null;
}

export async function saveWorkspaceDraft(state: Omit<DraftState, 'savedAt'>): Promise<void> {
  const payload: DraftState = { ...state, savedAt: new Date().toISOString() };
  const response = await apiFetch('/api/workspace-draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: payload }),
  });
  if (response.status === 413) throw new Error('This workspace is too large to autosave. Your previous draft was kept.');
  if (!response.ok) throw new Error('Could not autosave the workspace. Your previous draft was kept.');
}

export async function deleteWorkspaceDraft(): Promise<void> {
  const response = await apiFetch('/api/workspace-draft', { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not discard the previous draft.');
}
