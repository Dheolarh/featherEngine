/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the asset-store catalog, e.g. `https://cdn.example.com/store/`.
   * Defaults to the catalog bundled in `public/store/` (see scripts/build-store-catalog.mjs).
   * Pointing this at a hosted catalog is the whole migration to a real store backend.
   */
  readonly VITE_STORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
