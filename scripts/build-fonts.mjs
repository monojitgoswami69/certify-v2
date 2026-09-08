#!/usr/bin/env node

/**
 * Google Fonts Registry Build-Time Generator
 *
 * Automatically fetches the latest Google Fonts catalog at build time,
 * strips redundant metadata (unicode ranges, TTF binary URLs),
 * and compiles a compact JSON catalog into public/google-fonts.json.
 *
 * Guaranteed safe:
 * - If network is offline, safely preserves existing cache or writes fallback.
 * - In local dev, skips if cache is fresh (< 24h) to ensure 0ms startup delay.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'google-fonts.json');

const UPSTREAM_REGISTRY_URL =
  'https://cdn.jsdelivr.net/gh/jonathantneal/google-fonts-complete@master/google-fonts.json';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const CURATED_FALLBACK = [
  { family: 'Inter', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Roboto', category: 'sans-serif', variants: ['400', '500', '700'], popularity: 10 },
  { family: 'Montserrat', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Poppins', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Open Sans', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Playfair Display', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Cinzel', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Cormorant Garamond', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Merriweather', category: 'serif', variants: ['400', '700'], popularity: 9 },
  { family: 'EB Garamond', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 9 },
  { family: 'Great Vibes', category: 'handwriting', variants: ['400'], popularity: 10 },
  { family: 'Dancing Script', category: 'handwriting', variants: ['400', '500', '600', '700'], popularity: 10 },
  { family: 'Alex Brush', category: 'handwriting', variants: ['400'], popularity: 10 },
  { family: 'Pinyon Script', category: 'handwriting', variants: ['400'], popularity: 10 },
  { family: 'Allura', category: 'handwriting', variants: ['400'], popularity: 9 },
  { family: 'Bebas Neue', category: 'display', variants: ['400'], popularity: 9 },
  { family: 'Oswald', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 9 },
  { family: 'Roboto Mono', category: 'monospace', variants: ['400', '500', '600', '700'], popularity: 8 },
  { family: 'JetBrains Mono', category: 'monospace', variants: ['400', '500', '600', '700'], popularity: 8 },
  { family: 'Jura', category: 'sans-serif', variants: ['600', '700'], popularity: 9 },
  { family: 'Quicksand', category: 'sans-serif', variants: ['600', '700'], popularity: 9 },
  { family: 'Saira', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 9 },
  { family: 'Tomorrow', category: 'sans-serif', variants: ['500', '600', '700', '800'], popularity: 9 },
  { family: 'Electrolize', category: 'sans-serif', variants: ['400'], popularity: 9 },
];

async function generateFonts() {
  const isForce = process.argv.includes('--force');

  // If file exists and is recent (< 24h), skip unless --force
  if (fs.existsSync(OUTPUT_FILE) && !isForce) {
    try {
      const stats = fs.statSync(OUTPUT_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs < CACHE_MAX_AGE_MS && stats.size > 1000) {
        console.log(`[build-fonts] Using fresh cached google-fonts.json (${(stats.size / 1024).toFixed(1)} KB)`);
        return;
      }
    } catch {
      // Proceed to fetch
    }
  }

  console.log('[build-fonts] Fetching latest Google Fonts directory...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(UPSTREAM_REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const rawData = await res.json();
    const families = Object.keys(rawData).sort((a, b) => a.localeCompare(b));

    const formatted = families.map((family) => {
      const item = rawData[family] || {};
      const variants = new Set();
      if (item.variants) {
        if (item.variants.normal) Object.keys(item.variants.normal).forEach((w) => variants.add(w));
        if (item.variants.italic) Object.keys(item.variants.italic).forEach((w) => variants.add(w));
      }
      return {
        family,
        category: item.category || 'sans-serif',
        variants: Array.from(variants).sort((a, b) => Number(a) - Number(b)),
        popularity: 5,
      };
    });

    const publicDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(formatted));
    const kb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
    console.log(`[build-fonts] Successfully generated latest google-fonts.json (${formatted.length} fonts, ${kb} KB)`);
  } catch (err) {
    console.warn(`[build-fonts] Network fetch failed (${err.message}).`);

    if (fs.existsSync(OUTPUT_FILE) && fs.statSync(OUTPUT_FILE).size > 1000) {
      console.log('[build-fonts] Preserved existing google-fonts.json file.');
    } else {
      console.log(`[build-fonts] Writing curated fallback fonts (${CURATED_FALLBACK.length} fonts)...`);
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(CURATED_FALLBACK, null, 2));
    }
  }
}

generateFonts();
