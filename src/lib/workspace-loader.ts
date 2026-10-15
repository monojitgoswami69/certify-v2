import { useAppStore } from '../store/useAppStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { sanitizeFilename, buildVirtualCsvFile } from './utils';

interface LoadWorkspaceParams {
  eventName?: string | null;
  templateId?: string | null;
  token: string;
  shouldApply?: () => boolean;
}

interface LoadedTemplate {
  id?: string;
  name: string;
  imageData: string;
  layoutConfig?: any;
}

export function isWorkspaceLoadedFor(eventName: string): boolean {
  const state = useAppStore.getState();
  return Boolean(state.templateImage) && state.eventName === eventName;
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode template image'));
    img.src = src;
  });
}

/**
 * Fetches an event's (or template's) data and fully decodes the template image
 * before touching the store, so the canvas is never shown half-populated.
 */
export async function loadWorkspace({ eventName, templateId, token, shouldApply }: LoadWorkspaceParams): Promise<void> {
  const authHeaders = { Authorization: `Bearer ${token}` };
  let tpl: LoadedTemplate | null = null;
  let participants: any[] = [];

  if (eventName) {
    const res = await fetch(
      `/api/dashboard?event=${encodeURIComponent(eventName)}&includeRowData=true&includeTemplate=true`,
      { cache: 'no-store', headers: authHeaders }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Failed to load event workspace');
    }
    const data = await res.json();
    participants = data.participants || [];
    tpl = data.template || null;
  }

  if (!tpl && templateId) {
    const tplRes = await fetch(`/api/templates/${templateId}`, { headers: authHeaders });
    if (tplRes.ok) {
      const tplData = await tplRes.json();
      tpl = tplData.template || null;
    }
  }

  let templateFile: File | null = null;
  let templateImage: HTMLImageElement | null = null;
  if (tpl?.imageData) {
    const [blob, img] = await Promise.all([
      fetch(tpl.imageData).then((r) => r.blob()),
      decodeImage(tpl.imageData),
    ]);
    templateFile = new File([blob], `${sanitizeFilename(eventName || tpl.name)}.png`, { type: 'image/png' });
    templateImage = img;
  }

  if (shouldApply && !shouldApply()) return;

  const store = useAppStore.getState();
  if (eventName) {
    store.reset();
    useHistoryStore.getState().clearHistory();
  }

  if (templateFile && templateImage) {
    store.setTemplate(templateFile, templateImage, `${templateFile.name} (${templateImage.width}×${templateImage.height})`);
    const layout = tpl?.layoutConfig;
    if (Array.isArray(layout?.boxes)) store.setBoxes(layout.boxes);
    if (Array.isArray(layout?.qrZones)) store.setQrZones(layout.qrZones);
    if (layout?.defaultFont) store.setDefaultFont(layout.defaultFont);
    if (layout?.defaultFontSize) store.setDefaultFontSize(layout.defaultFontSize);
    if (layout?.defaultFontColor) store.setDefaultFontColor(layout.defaultFontColor);
  }

  if (eventName) {
    if (participants.length > 0) {
      const { file, headers, rows } = buildVirtualCsvFile(eventName, participants);
      store.setCsvData(file, headers, rows);
    }
    store.setEventName(eventName);

    const certIds = new Map<number, string>();
    participants.forEach((p: { id?: string }, idx: number) => {
      if (p.id) certIds.set(idx + 2, p.id);
    });
    if (certIds.size > 0) {
      store.setBatchRegistered(true, certIds);
    }
  }
}
