import { useEditorStore } from '../store/editorStore';

interface AssetResolverOptions {
  publicUrl: string;
  credential: string;
  fetchImpl?: typeof fetch;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function assetUrl(publicUrl: string, hash: string): string {
  const url = new URL(publicUrl);
  url.hash = '';
  url.search = '';
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/collaboration/assets/${hash}`.replace(/\/{2,}/g, '/');
  return url.toString();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticated, bounded-concurrency guest asset overlay. Blob URLs never enter Yjs or a project
 * save and each response is verified against the content hash carried by shared metadata.
 */
export class CollaborationAssetResolver {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly fetchImpl: typeof fetch;
  private readonly abortController = new AbortController();
  private credential: string;
  private destroyed = false;

  constructor(private readonly options: AssetResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.credential = options.credential;
  }

  /** The relay rotates this short-lived capability on every authenticated reconnect. */
  updateCredential(credential: string): void {
    if (!this.destroyed) this.credential = credential;
  }

  async resolve(hash: string): Promise<string> {
    if (this.destroyed) throw new Error('The collaboration asset session has ended.');
    if (!HASH_PATTERN.test(hash)) throw new Error('The shared asset has an invalid content hash.');
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const existing = this.inflight.get(hash);
    if (existing) return existing;
    const request = this.fetchAndVerify(hash).finally(() => this.inflight.delete(hash));
    this.inflight.set(hash, request);
    return request;
  }

  private async fetchAndVerify(hash: string): Promise<string> {
    const response = await this.fetchImpl(assetUrl(this.options.publicUrl, hash), {
      headers: { Authorization: `Bearer ${this.credential}` },
      cache: 'no-store',
      signal: this.abortController.signal,
    });
    if (!response.ok) throw new Error(`Could not load a shared asset (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (this.destroyed) throw new Error('The collaboration asset session has ended.');
    if ((await sha256Hex(bytes)) !== hash) throw new Error('A shared asset failed its integrity check.');
    if (this.destroyed) throw new Error('The collaboration asset session has ended.');
    const url = URL.createObjectURL(new Blob([bytes], {
      type: response.headers.get('content-type') || 'application/octet-stream',
    }));
    if (this.destroyed) {
      URL.revokeObjectURL(url);
      throw new Error('The collaboration asset session has ended.');
    }
    this.cache.set(hash, url);
    return url;
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error('The collaboration asset session has ended.'));
        return;
      }
      const timer = window.setTimeout(() => {
        this.abortController.signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new Error('The collaboration asset session has ended.'));
      };
      this.abortController.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async resolveWithRetry(hash: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        return await this.resolve(hash);
      } catch (error) {
        lastError = error;
        if (this.destroyed || attempt === 6) break;
        await this.waitForRetry(Math.min(8_000, 500 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not load a shared asset.');
  }

  /** Resolve metadata on demand after a CRDT projection without touching serialized asset fields. */
  async hydrateMissingAssets(): Promise<void> {
    const candidates = useEditorStore.getState().assets.filter(
      (asset) => !asset.url && typeof asset.hash === 'string' && HASH_PATTERN.test(asset.hash),
    );
    const queue = [...candidates];
    const worker = async () => {
      while (!this.destroyed) {
        const asset = queue.shift();
        if (!asset) return;
        try {
          const url = await this.resolveWithRetry(asset.hash!);
          if (this.destroyed) return;
          useEditorStore.setState((state) => ({
            assets: state.assets.map((current) =>
              current.id === asset.id && current.hash === asset.hash && !current.url
                ? { ...current, url }
                : current,
            ),
          }));
        } catch {
          // A later project projection retries transient host/network failures.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
    this.inflight.clear();
  }
}
