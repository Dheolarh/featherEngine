/**
 * Bridge so DOM UI / AI tools can request a screenshot without holding an R3F `gl` reference.
 * Viewport registers a handler while the Canvas is mounted; callers invoke captureViewportScreenshot().
 */
export type ViewportCaptureHandler = () => Promise<string>;
/** Returns the viewport as a PNG data URL without saving it anywhere. */
export type ViewportImageHandler = () => string | null;

let handler: ViewportCaptureHandler | null = null;
let imageHandler: ViewportImageHandler | null = null;

export function setViewportCaptureHandler(next: ViewportCaptureHandler | null) {
  handler = next;
}

export function setViewportImageHandler(next: ViewportImageHandler | null) {
  imageHandler = next;
}

/**
 * Grab the live viewport as a data URL, for UI that wants the pixels rather than a saved file —
 * package cover art, for instance. Null when no viewport is mounted.
 */
export async function captureViewportImage(): Promise<string | null> {
  return imageHandler?.() ?? null;
}

/** Capture the live viewport to PNG and save it. Returns a short destination label, or an error string. */
export async function captureViewportScreenshot(): Promise<string> {
  if (!handler) return 'Viewport is not ready — open the 3D viewport and try again.';
  return handler();
}
