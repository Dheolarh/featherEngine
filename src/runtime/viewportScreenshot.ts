import { getPlatform } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { pushToast } from '../store/toastStore';

function stampFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `feather-screenshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Capture a WebGL canvas (preserveDrawingBuffer must be on — Viewport enables it) and write a PNG
 * next to the project on desktop, or download it on web.
 */
export async function saveViewportScreenshot(canvas: HTMLCanvasElement): Promise<string> {
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) {
    pushToast('error', 'Could not read the viewport pixels.');
    return 'Screenshot failed — canvas produced no PNG data.';
  }
  const bytes = dataUrlToBytes(dataUrl);
  const fileName = stampFileName();
  const platform = await getPlatform();
  const projectDir = useProjectStore.getState().projectDir;

  if (platform.saveInProject && projectDir && projectDir !== 'web') {
    const path = await platform.saveInProject(projectDir, 'screenshots', fileName, bytes);
    pushToast('success', path, { title: 'Screenshot saved' });
    return `Saved screenshot to ${path}`;
  }

  const dest = await platform.saveBinary(fileName, bytes, {
    title: 'Save screenshot',
    mimeType: 'image/png',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (!dest) {
    pushToast('info', 'Screenshot cancelled.');
    return 'Screenshot cancelled.';
  }
  pushToast('success', dest, { title: 'Screenshot saved' });
  return `Screenshot ${dest}`;
}
