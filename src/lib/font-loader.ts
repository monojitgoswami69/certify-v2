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
];
