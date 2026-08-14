/**
 * Bridge so DOM UI / AI tools can request a screenshot without holding an R3F `gl` reference.
 * Viewport registers a handler while the Canvas is mounted; callers invoke captureViewportScreenshot().
 */
export type ViewportCaptureHandler = () => Promise<string>;

let handler: ViewportCaptureHandler | null = null;

export function setViewportCaptureHandler(next: ViewportCaptureHandler | null) {
  handler = next;
}

/** Capture the live viewport to PNG and save it. Returns a short destination label, or an error string. */
export async function captureViewportScreenshot(): Promise<string> {
  if (!handler) return 'Viewport is not ready — open the 3D viewport and try again.';
  return handler();
}
