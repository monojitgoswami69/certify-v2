import type { TextBox, QrZone } from '../types';

export interface AutoSaveTemplateParams {
  templateImage: HTMLImageElement | null;
  templateFile: File | null;
  eventName?: string;
  boxes: TextBox[];
  qrZones: QrZone[];
  defaultFont?: string;
  defaultFontSize?: number;
  defaultFontColor?: string;
  token?: string | null;
}

/**
 * Automatically persists the current template image and box layout configuration
 * to the database when certificate generation is executed.
 */
export async function autoSaveCurrentTemplate(
  params: AutoSaveTemplateParams
): Promise<{ id?: string; name?: string } | null> {
  const {
    templateImage,
    templateFile,
    eventName,
    boxes,
    qrZones,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    token,
  } = params;

  if (!templateImage) return null;

  try {
    const name =
      eventName?.trim() ||
      (templateFile?.name ? templateFile.name.replace(/\.[^/.]+$/, '').trim() : 'Certificate Template');

    // Convert HTMLImageElement to Base64 PNG data URL
    const canvas = document.createElement('canvas');
    canvas.width = templateImage.naturalWidth || templateImage.width;
    canvas.height = templateImage.naturalHeight || templateImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(templateImage, 0, 0);
    const imageData = canvas.toDataURL('image/png', 0.95);

    const payload = {
      name,
      imageData,
      width: canvas.width,
      height: canvas.height,
      layoutConfig: {
        boxes,
        qrZones,
        defaultFont: defaultFont || 'Inter',
        defaultFontSize: defaultFontSize || 28,
        defaultFontColor: defaultFontColor || '#000000',
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/templates', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[AutoSave Template] Server responded with error:', err);
      return null;
    }

    const data = await res.json();
    return data.template || null;
  } catch (error) {
    console.warn('[AutoSave Template] Failed to auto-save template:', error);
    return null;
  }
}
