import type { TextBox } from '../types';
import { resolveFieldValue } from './utils';

type RenderLayout = { boxes: Array<Pick<TextBox, 'field' | 'kind'>> };

/** Only fields printed by dynamic text boxes are part of the public artifact. */
export function getDesignFields(layout: RenderLayout): string[] {
  return [...new Set(layout.boxes
    .filter((box) => box?.kind !== 'static' && typeof box?.field === 'string' && box.field.trim())
    .map((box) => box.field))];
}

export function freezeRenderFields(
  layout: RenderLayout,
  row: Record<string, string> | null
): Record<string, string> {
  return Object.fromEntries(getDesignFields(layout).map((field) => [field, resolveFieldValue(field, row)]));
}
