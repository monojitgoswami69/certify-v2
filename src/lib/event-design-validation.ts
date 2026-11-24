import type { IssuedEventDesign } from './event-design';
import { parseImageDataUrl } from './image-validation';

export function readIssuedDesign(input: unknown): IssuedEventDesign | null {
  if (!input || typeof input !== 'object') return null;
  const { imageData, width, height, layoutConfig } = input as Partial<IssuedEventDesign>;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width)
      || !Number.isInteger(height) || width <= 0 || height <= 0
      || typeof imageData !== 'string' || imageData.length > 20 * 1024 * 1024
      || !parseImageDataUrl(imageData)) return null;
  if (!layoutConfig || !Array.isArray(layoutConfig.boxes)
      || layoutConfig.boxes.some((box) => !box || typeof box !== 'object'
        || (box.kind !== 'static' && typeof box.field !== 'string'))
      || (layoutConfig.qrZones !== undefined && !Array.isArray(layoutConfig.qrZones))
      || (layoutConfig.images !== undefined && (!Array.isArray(layoutConfig.images)
        || layoutConfig.images.length > 30
        || layoutConfig.images.some((image) => !parseImageDataUrl(image?.src))))
      || JSON.stringify(layoutConfig).length > 1024 * 1024) return null;

  return { imageData, width, height, layoutConfig };
}
