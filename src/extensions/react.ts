import { useSyncExternalStore } from 'react';
import { extensionRegistry } from './host';

/** Subscribe a React surface to plugin, command, and panel registration changes. */
export function useExtensionSnapshot() {
  return useSyncExternalStore(
    extensionRegistry.subscribe,
    extensionRegistry.getSnapshot,
    extensionRegistry.getSnapshot,
  );
}
