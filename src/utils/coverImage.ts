/**
 * Cover art for a package.
 *
 * The image is stored inside the package manifest as a data URL, and the store catalog copies it
 * into `catalog.json` — so it is downloaded by everyone browsing the store, not just people who
 * install. That makes size the whole design constraint: a 4 MB phone photo dropped in unedited
 * would bloat every catalog fetch. Covers are downscaled and re-encoded to land in the low tens of
 * kilobytes.
 */

/** Longest edge of a stored cover, in pixels. Cards render at ~128px; 512 covers retina + detail view. */
export const COVER_MAX_EDGE = 512;

/** Re-encode below this, or the catalog grows by a megabyte per listing. */
const COVER_MAX_BYTES = 96 * 1024;

/** Scale (w,h) to fit inside a square of `max`, preserving aspect. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Rough decoded byte length of a base64 data URL, without allocating the bytes. */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file could not be read as an image.'));
    image.src = src;
  });
}

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

/**
 * Turn a picked file (or an existing data URL) into a cover: downscaled to `COVER_MAX_EDGE` and
 * re-encoded as JPEG, stepping quality down until it fits the budget. Cards are opaque, so losing
 * alpha costs nothing and JPEG is dramatically smaller than PNG for photographic art.
 */
export async function makeCoverImage(source: Blob | string): Promise<string> {
  const sourceUrl = typeof source === 'string' ? source : await readAsDataUrl(source);
  const image = await loadImage(sourceUrl);

  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, COVER_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process that image.');
  // Flatten onto white: a transparent PNG would otherwise composite to black under JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const encoded = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlByteLength(encoded) <= COVER_MAX_BYTES) return encoded;
  }
  // Still too big at the lowest quality — halve the edge once and accept the result.
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(width / 2));
  small.height = Math.max(1, Math.round(height / 2));
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.6);
}
