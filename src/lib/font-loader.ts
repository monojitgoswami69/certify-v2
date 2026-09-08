/**
 * Google Fonts Loader with Managed Injection & Caching
 */

import type { Font, FontCategory } from '../types';

const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2';

const requestedFonts = new Set<string>();
let cachedFonts: Font[] = [];
let fontPromise: Promise<Font[]> | null = null;

export async function initializeGoogleFonts(): Promise<Font[]> {
  if (cachedFonts.length > 0) return cachedFonts;
  if (fontPromise) return fontPromise;

  fontPromise = (async () => {
    try {
      const res = await fetch('/google-fonts.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Font[] = await res.json();
      cachedFonts = data;
      return data;
    } catch {
      cachedFonts = CURATED_FALLBACK_FONTS;
      return CURATED_FALLBACK_FONTS;
    }
  })();

  return fontPromise;
}

export function getAllGoogleFonts(): Font[] {
  return cachedFonts.length > 0 ? cachedFonts : CURATED_FALLBACK_FONTS;
}

export function loadGoogleFont(family: string): boolean {
  if (!family) return false;
  if (requestedFonts.has(family)) return true;

  if (typeof document !== 'undefined') {
    const existing = document.querySelector(`link[data-font="${family}"]`);
    if (!existing) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-font', family);
      link.href = `${GOOGLE_FONTS_CSS_URL}?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
    }
    requestedFonts.add(family);
  }

  return true;
}

/**
 * Ensures the given font families are actually loaded into the document's
 * FontFaceSet before rendering. MUST be awaited prior to canvas drawing to
 * guarantee certificates render with the correct webfont (not a fallback).
 */
export async function ensureFontsLoaded(fonts: Iterable<string>): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;

  const families = Array.from(new Set(fonts)).filter(Boolean);
  for (const family of families) {
    loadGoogleFont(family);
  }

  await Promise.all(
    families.map(async (family) => {
      try {
        await Promise.all([
          document.fonts.load(`400 16px "${family}"`),
          document.fonts.load(`600 16px "${family}"`),
          document.fonts.load(`700 16px "${family}"`),
        ]);
      } catch {
        // Font may not support all weights; ignore and rely on CSS fallback.
      }
    })
  );

  try {
    await document.fonts.ready;
  } catch {
    // no-op
  }
}

export interface WorkerFontData {
  family: string;
  buffer: ArrayBuffer;
  weight?: string;
  style?: string;
}

const workerFontCache = new Map<string, WorkerFontData[]>();

/**
 * Downloads font binary data (WOFF2) for the given font families so they can be transferred
 * directly into Web Worker threads (OffscreenCanvas) with zero subsequent network overhead.
 */
export async function loadFontsForWorker(fonts: Iterable<string>): Promise<WorkerFontData[]> {
  const families = Array.from(new Set(fonts))
    .map((f) => (f || '').replace(/['"]/g, '').trim())
    .filter(Boolean);

  const results: WorkerFontData[] = [];
  const uncached: string[] = [];

  for (const family of families) {
    const cached = workerFontCache.get(family);
    if (cached && cached.length > 0) {
      results.push(...cached);
    } else {
      uncached.push(family);
    }
  }

  if (uncached.length === 0) return results;

  await Promise.all(
    uncached.map(async (family) => {
      try {
        let css = '';
        try {
          const res = await fetch(
            `${GOOGLE_FONTS_CSS_URL}?family=${encodeURIComponent(family)}:wght@400;600;700&display=swap`,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
            }
          );
          if (res.ok) css = await res.text();
        } catch {
          // ignore
        }

        if (!css) {
          try {
            const fallbackRes = await fetch(
              `${GOOGLE_FONTS_CSS_URL}?family=${encodeURIComponent(family)}&display=swap`,
              {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
              }
            );
            if (fallbackRes.ok) css = await fallbackRes.text();
          } catch {
            // ignore
          }
        }

        if (!css) return;

        const regex = /@font-face\s*\{([^}]+)\}/g;
        let match: RegExpExecArray | null;
        const fontFaces: Array<{
          weight: string;
          style: string;
          url: string;
          isLatin: boolean;
        }> = [];

        while ((match = regex.exec(css)) !== null) {
          const block = match[1];
          const weight = block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() || '400';
          const style = block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || 'normal';
          const srcMatch = block
            .match(/src:\s*url\(([^)]+)\)/)?.[1]
            ?.replace(/['"]/g, '')
            .trim();
          const isLatin = block.includes('U+0000-00FF') || !block.includes('unicode-range');
          if (srcMatch) {
            fontFaces.push({ weight, style, url: srcMatch, isLatin });
          }
        }

        // Prefer Latin subsets (standard ASCII/European glyphs for certificate names)
        const latinFaces = fontFaces.filter((f) => f.isLatin);
        const facesToUse = latinFaces.length > 0 ? latinFaces : fontFaces;

        // Group by weight so we download at most 1 woff2 per weight variant
        const byWeight = new Map<string, (typeof facesToUse)[0]>();
        for (const face of facesToUse) {
          if (!byWeight.has(face.weight)) {
            byWeight.set(face.weight, face);
          }
        }

        const familyFontData: WorkerFontData[] = [];
        for (const [weight, face] of byWeight.entries()) {
          try {
            const fontRes = await fetch(face.url);
            if (fontRes.ok) {
              const buffer = await fontRes.arrayBuffer();
              familyFontData.push({
                family,
                buffer,
                weight,
                style: face.style,
              });
            }
          } catch (fetchErr) {
            console.warn(`[FontLoader] Failed to download font binary for ${family}:`, fetchErr);
          }
        }

        if (familyFontData.length > 0) {
          workerFontCache.set(family, familyFontData);
          results.push(...familyFontData);
        }
      } catch (err) {
        console.warn(`[FontLoader] Failed to process worker font ${family}:`, err);
      }
    })
  );

  return results;
}

export function isFontLoaded(family: string): boolean {
  if (!family) return false;
  return requestedFonts.has(family);
}

export function getFontFamilyCSS(family: string, category?: FontCategory): string {
  const fallbacks: Record<string, string> = {
    serif: 'Georgia, "Times New Roman", serif',
    'sans-serif': 'system-ui, -apple-system, sans-serif',
    display: 'system-ui, sans-serif',
    handwriting: 'cursive',
    monospace: 'ui-monospace, "Courier New", monospace',
  };
  return `"${family}", ${fallbacks[category || 'sans-serif']}`;
}

export function searchFonts(query: string, fonts: Font[]): Font[] {
  if (!query.trim()) return fonts;
  const q = query.toLowerCase().trim();
  return fonts
    .filter(f => f.family.toLowerCase().includes(q) || f.category.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.family.toLowerCase().startsWith(q);
      const bStarts = b.family.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return b.popularity - a.popularity;
    });
}

const CURATED_FALLBACK_FONTS: Font[] = [
  { family: 'Inter', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Roboto', category: 'sans-serif', variants: ['400', '500', '700'], popularity: 5 },
  { family: 'Open Sans', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Lato', category: 'sans-serif', variants: ['400', '700'], popularity: 5 },
  { family: 'Montserrat', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Poppins', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Playfair Display', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Merriweather', category: 'serif', variants: ['400', '700'], popularity: 5 },
  { family: 'Dancing Script', category: 'handwriting', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Bebas Neue', category: 'display', variants: ['400'], popularity: 5 },
  { family: 'Roboto Mono', category: 'monospace', variants: ['400', '500', '600', '700'], popularity: 5 },
  { family: 'Quantico', category: 'display', variants: ['400', '700'], popularity: 5 },
  { family: 'Jura', category: 'sans-serif', variants: ['600', '700'], popularity: 5 },
  { family: 'Quicksand', category: 'sans-serif', variants: ['600', '700'], popularity: 5 },
  { family: 'Tomorrow', category: 'sans-serif', variants: ['500', '600', '700', '800'], popularity: 5 },
  { family: 'Electrolize', category: 'sans-serif', variants: ['400'], popularity: 5 },
];
