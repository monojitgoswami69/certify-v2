import { apiFetch, fetchEventDesign } from './api-client';
import { useAppStore } from '../store/useAppStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { sanitizeFilename, imageSourceToBlob } from './utils';
import type { EventLayout, IssuedEventDesign } from './event-design';

export async function decodeDesignImage(design: Pick<IssuedEventDesign, 'imageData'>): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = design.imageData;
  await image.decode();
  return image;
}

export async function decodeArtworkBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await decodeDesignImage({ imageData: url });
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface LoadWorkspaceParams {
  copyEventId?: string | null;
  templateId?: string | null;
  shouldApply?: () => boolean;
}

/** Loads only artwork and layout into an empty, editable draft. */
export async function loadWorkspace({ copyEventId, templateId, shouldApply }: LoadWorkspaceParams): Promise<void> {
  let name: string;
  let template: { imageData: string; layoutConfig: EventLayout };

  if (copyEventId) {
    const { design, event } = await fetchEventDesign(copyEventId);
    if (!design) throw new Error('The original artwork for this event is unavailable.');
    template = design;
    name = event.name;
  } else if (templateId) {
    const response = await apiFetch(`/api/templates/${encodeURIComponent(templateId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Failed to load saved template');
    name = data.template.name;
    template = data.template;
  } else {
    return;
  }

  const blob = await imageSourceToBlob(template.imageData);
  const image = await decodeArtworkBlob(blob);
  if (shouldApply && !shouldApply()) return;

  const store = useAppStore.getState();
  store.reset();
  useHistoryStore.getState().clearHistory();
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  const file = new File([blob], `${sanitizeFilename(name)}.${extension}`, { type: blob.type || 'image/png' });
  store.setTemplate(file, image, `${file.name} (${image.width}×${image.height})`);

  const layout = template.layoutConfig;
  if (Array.isArray(layout?.boxes)) store.setBoxes(layout.boxes);
  if (Array.isArray(layout?.qrZones)) store.setQrZones(layout.qrZones);
  if (Array.isArray(layout?.images)) store.setImages(layout.images);
  if (layout?.defaultFont) store.setDefaultFont(layout.defaultFont);
  if (layout?.defaultFontSize) store.setDefaultFontSize(layout.defaultFontSize);
  if (layout?.defaultFontColor) store.setDefaultFontColor(layout.defaultFontColor);
  if (copyEventId) {
    store.setEventName(name);
    store.setEventLabel('Copy');
  }
}
