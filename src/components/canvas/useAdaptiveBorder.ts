'use client';

import { useState, useEffect } from 'react';

export interface AdaptiveBorder {
  borderColor: string;
  outerRing: string;
  shadow: string;
}

const DEFAULT_BORDER: AdaptiveBorder = {
  borderColor: '#1e293b',
  outerRing: 'rgba(15, 23, 42, 0.2)',
  shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
};

/**
 * Smart high-contrast border detection based on template edge luminance.
 * Ensures the certificate canvas boundary is clearly distinguished against
 * both light, dark, and vibrant backgrounds.
 */
export function useAdaptiveBorder(templateImage: HTMLImageElement | null): AdaptiveBorder {
  const [adaptiveBorder, setAdaptiveBorder] = useState<AdaptiveBorder>(DEFAULT_BORDER);

  useEffect(() => {
    if (!templateImage) return;

    try {
      const offscreen = document.createElement('canvas');
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const size = 64;
      offscreen.width = size;
      offscreen.height = size;
      ctx.drawImage(templateImage, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size).data;
      let totalLum = 0;
      let count = 0;

      // Sample 3px outer perimeter
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          if (x < 3 || x >= size - 3 || y < 3 || y >= size - 3) {
            const idx = (y * size + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            if (a > 30) {
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              totalLum += lum;
              count++;
            }
          }
        }
      }

      const avgLum = count > 0 ? totalLum / count : 255;

      if (avgLum > 140) {
        // Light edge (white, cream, pale yellow): bold dark slate border
        setAdaptiveBorder({
          borderColor: '#1e293b',
          outerRing: 'rgba(15, 23, 42, 0.2)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
        });
      } else if (avgLum < 90) {
        // Dark edge (black, deep navy, dark brown): bold illuminated white border
        setAdaptiveBorder({
          borderColor: '#ffffff',
          outerRing: 'rgba(255, 255, 255, 0.4)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65), 0 0 25px rgba(255, 255, 255, 0.25)',
        });
      } else {
        // Mid-tone & colorful edges (teal, orange, purple, green): dual high-contrast border
        setAdaptiveBorder({
          borderColor: '#0f172a',
          outerRing: 'rgba(255, 255, 255, 0.95)',
          shadow: '0 25px 60px -15px rgba(0, 0, 0, 0.45)',
        });
      }
    } catch {
      setAdaptiveBorder(DEFAULT_BORDER);
    }
  }, [templateImage]);

  return adaptiveBorder;
}
