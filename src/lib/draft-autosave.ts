/**
 * Server-side draft workspaces (client helper).
 *
 * Debounced autosave of the editor session (layout, roster, email copy,
 * event name) to the account's draft row, plus recovery. The template
 * artwork is not stored in the draft — drafts reference it by file name and
 * the matching saved template is restored on recovery (best effort).
 */
import { getAuthToken } from './api-client';
import type { TextBox, QrZone, ImageElement, EmailSettings } from '../types';

export interface DraftState {
  savedAt: string;
  eventName: string;
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

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = { 'X-Certify-Request': '1' };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function fetchWorkspaceDraft(): Promise<DraftState | null> {
  try {
    const res = await fetch('/api/workspace-draft', { credentials: 'same-origin', headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as DraftResponse;
    return data.draft?.state ?? null;
  } catch {
    return null;
  }
}

export async function saveWorkspaceDraft(state: Omit<DraftState, 'savedAt'>): Promise<void> {
  const payload: DraftState = { ...state, savedAt: new Date().toISOString() };
  await fetch('/api/workspace-draft', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: authHeaders(true),
    body: JSON.stringify({ state: payload }),
  }).catch(() => undefined);
}

export async function deleteWorkspaceDraft(): Promise<void> {
  await fetch('/api/workspace-draft', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: authHeaders(),
  }).catch(() => undefined);
}
