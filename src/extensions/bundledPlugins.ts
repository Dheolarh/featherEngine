import type { FeatherPluginDefinition } from './types';
import { exampleSceneToolsPlugin } from './exampleSceneTools';

/** Plugins compiled into this build. A future package loader can feed the same host at runtime. */
export const bundledPlugins: readonly FeatherPluginDefinition[] = [exampleSceneToolsPlugin];
