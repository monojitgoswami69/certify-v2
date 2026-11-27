import { GlobalFonts } from '@napi-rs/canvas';
import type { WorkerLogger } from './logger.js';

const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2';
const FONT_FETCH_TIMEOUT_MS = 8_000;

// Non-WOFF2 User-Agent intentionally asks Google Fonts for TrueType (.ttf),
// which Skia / GlobalFonts.register loads natively without needing WOFF2 decompression.
const TTF_REQUEST_HEADERS = {
  'User-Agent': 'WeCertify-Worker/1.0',
};

const registeredFamilies = new Set<string>();
const inFlightFamilies = new Map<string, Promise<void>>();

const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

export async function ensureWorkerFontsLoaded(
  families: Iterable<string>,
  logger: WorkerLogger,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const cleanFamilies = Array.from(new Set(families))
    .map((f) => (f || '').replace(/['"\\\r\n]/g, '').trim())
    .filter((f) => Boolean(f) && !CSS_GENERIC_FAMILIES.has(f.toLowerCase()));

  await Promise.all(
    cleanFamilies.map(async (family) => {
      if (registeredFamilies.has(family)) return;
      let pending = inFlightFamilies.get(family);
      if (!pending) {
        pending = loadAndRegisterFamily(family, logger, fetchImpl).finally(() => {
          inFlightFamilies.delete(family);
        });
        inFlightFamilies.set(family, pending);
      }
      await pending;
    })
  );
}

async function loadAndRegisterFamily(
  family: string,
  logger: WorkerLogger,
  fetchImpl: typeof fetch
): Promise<void> {
  let css = '';
  for (const query of [`${encodeURIComponent(family)}:wght@400;600;700`, encodeURIComponent(family)]) {
    try {
      const res = await fetchImpl(`${GOOGLE_FONTS_CSS_URL}?family=${query}`, {
        headers: TTF_REQUEST_HEADERS,
        signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        css = await res.text();
        if (css) break;
      }
    } catch {
      // Fall through to plain query or bundled system fonts.
    }
  }

  if (!css) {
    logger.warn('Font stylesheet unavailable; falling back to system font', { family });
    return;
  }

  const urls = new Set<string>();
  const blockRe = /@font-face\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(css)) !== null) {
    const block = match[1];
    const url = block.match(/url\((https:[^)]+)\)/)?.[1]?.replace(/['"]/g, '').trim();
    if (url) urls.add(url);
  }

  let registeredCount = 0;
  for (const url of Array.from(urls).slice(0, 4)) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (GlobalFonts.register(buf, family)) {
        registeredCount++;
      }
    } catch {
      // Skip individual weight fetch errors
    }
  }

  if (registeredCount > 0) {
    registeredFamilies.add(family);
    logger.debug('Registered Google Font in Skia runtime', { family, variants: registeredCount });
  }
}
