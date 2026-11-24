/** Keeps zooming and high-DPI displays from allocating export-sized previews. */
export function getPreviewBackingSize(cssWidth: number, cssHeight: number, devicePixelRatio: number) {
  const maxPixels = 8_000_000;
  const maxEdge = 4096;
  const scale = Math.min(
    devicePixelRatio || 1,
    Math.sqrt(maxPixels / (cssWidth * cssHeight)),
    maxEdge / Math.max(cssWidth, cssHeight)
  );
  return {
    width: Math.max(1, Math.floor(cssWidth * scale)),
    height: Math.max(1, Math.floor(cssHeight * scale)),
  };
}
