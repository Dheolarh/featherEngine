/**
 * Content addressing for project assets.
 *
 * An asset's SHA-256 is its identity: it lets an install recognise bytes the project already has
 * (so two packages sharing a 22 MB character model store and download it once), and it disambiguates
 * files that merely share a name — two different `tree.glb` files used to silently overwrite each
 * other on disk.
 */

/** SHA-256 of a byte buffer, lowercase hex. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // Passed straight through as a BufferSource: digest accepts a TypedArray, and re-slicing into a
  // fresh ArrayBuffer both copies the whole asset needlessly and trips a cross-realm check in jsdom.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode a `data:` URL's base64 payload into bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const binary = atob(comma === -1 ? dataUrl : dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `hero.glb` + a hash becomes `hero-a1b2c3d4e5f6.glb`. Stable for identical bytes, so re-importing
 * the same asset reuses the same file instead of writing a second copy — and two different files
 * that happen to share a name can no longer clobber one another.
 */
export function contentAddressedName(name: string, hash: string): string {
  const short = hash.slice(0, 12);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${short}${name.slice(dot)}` : `${name}-${short}`;
}
