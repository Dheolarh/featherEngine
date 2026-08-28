import { create } from 'zustand';
import { z } from 'zod';
import { engineTools } from './tools';

export interface WebMcpToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface WebMcpCallLog {
  id: string;
  timestamp: number;
  tool: string;
  input: unknown;
  output?: unknown;
  durationMs: number;
  isError: boolean;
  error?: string;
}

export interface WebMcpToolExecutionResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<WebMcpToolExecutionResponse>;
}

export interface ModelContextInterface {
  registerTool?: (tool: WebMcpToolDefinition) => void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: unknown) => void;
}

interface WebMcpState {
  isNativeSupported: boolean;
  isRegistered: boolean;
  registeredTools: WebMcpToolManifest[];
  callHistory: WebMcpCallLog[];
  activeCall: { id: string; tool: string; input: unknown; startedAt: number } | null;
  lastToolExecuted: string | null;
  totalCalls: number;
  totalErrors: number;
  showAgentBar: boolean;
  setShowAgentBar: (show: boolean) => void;
  toggleShowAgentBar: () => void;
  setRegistered: (registered: boolean, tools: WebMcpToolManifest[], isNative: boolean) => void;
  recordCallStart: (call: { id: string; tool: string; input: unknown; startedAt: number }) => void;
  recordCallEnd: (log: WebMcpCallLog) => void;
  clearHistory: () => void;
  executeToolDirectly: (toolName: string, input: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

type LooseTool = {
  description?: string;
  inputSchema?: unknown;
  execute?: (input: unknown, options: { toolCallId: string; messages: never[] }) => unknown;
};

const looseTools = engineTools as unknown as Record<string, LooseTool>;

const isZodSchema = (value: unknown): value is z.ZodType =>
  Boolean(value && typeof (value as z.ZodType).safeParse === 'function');

export const useWebMcpStore = create<WebMcpState>((set, get) => ({
  isNativeSupported: false,
  isRegistered: false,
  registeredTools: [],
  callHistory: [],
  activeCall: null,
  lastToolExecuted: null,
  totalCalls: 0,
  totalErrors: 0,
  showAgentBar: typeof localStorage !== 'undefined' ? localStorage.getItem('nodeforge.showAgentBar') !== 'false' : true,

  setShowAgentBar: (showAgentBar: boolean) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('nodeforge.showAgentBar', String(showAgentBar));
    set({ showAgentBar });
  },

  toggleShowAgentBar: () => {
    const next = !get().showAgentBar;
    if (typeof localStorage !== 'undefined') localStorage.setItem('nodeforge.showAgentBar', String(next));
    set({ showAgentBar: next });
  },

  setRegistered: (registered, tools, isNative) =>
    set({
      isRegistered: registered,
      registeredTools: tools,
      isNativeSupported: isNative,
    }),

  recordCallStart: (call) =>
    set({
      activeCall: call,
      lastToolExecuted: call.tool,
    }),

  recordCallEnd: (log) =>
    set((state) => ({
      activeCall: state.activeCall?.id === log.id ? null : state.activeCall,
      callHistory: [log, ...state.callHistory].slice(0, 100),
      totalCalls: state.totalCalls + 1,
      totalErrors: log.isError ? state.totalErrors + 1 : state.totalErrors,
    })),

  clearHistory: () =>
    set({
      callHistory: [],
      totalCalls: 0,
      totalErrors: 0,
      activeCall: null,
    }),

  executeToolDirectly: async (toolName: string, input: unknown) => {
    const def = looseTools[toolName];
    if (!def?.execute) {
      return { ok: false, error: `Tool "${toolName}" not found in engineTools` };
    }
    const callId = crypto.randomUUID();
    const startedAt = Date.now();
    get().recordCallStart({ id: callId, tool: toolName, input, startedAt });

    try {
      let validatedInput: unknown = input ?? {};
      if (isZodSchema(def.inputSchema)) {
        const parsed = def.inputSchema.safeParse(validatedInput);
        if (!parsed.success) {
          const errMsg = `Validation error for ${toolName}: ${parsed.error.message}`;
          get().recordCallEnd({
            id: callId,
            timestamp: startedAt,
            tool: toolName,
            input,
            durationMs: Date.now() - startedAt,
            isError: true,
            error: errMsg,
          });
          return { ok: false, error: errMsg };
        }
        validatedInput = parsed.data;
      }

      const result = await def.execute(validatedInput, { toolCallId: callId, messages: [] });
      const durationMs = Date.now() - startedAt;

      get().recordCallEnd({
        id: callId,
        timestamp: startedAt,
        tool: toolName,
        input: validatedInput,
        output: result ?? 'OK',
        durationMs,
        isError: false,
      });

      return { ok: true, result: result ?? 'OK' };
    } catch (caught) {
      const errMsg = caught instanceof Error ? caught.message : String(caught);
      const durationMs = Date.now() - startedAt;

      get().recordCallEnd({
        id: callId,
        timestamp: startedAt,
        tool: toolName,
        input,
        durationMs,
        isError: true,
        error: errMsg,
      });

      return { ok: false, error: errMsg };
    }
  },
}));

/**
 * Curated high-leverage 3D engine tools exposed to browser AI agents over WebMCP.
 * External browser controllers (like ChatGPT's in-app browser) enforce strict payload
 * and tool-count limits (typically <= 16 tools). This focused catalog gives agents full 3D
 * creative, physical, atmospheric, scripting, and playtest authority while keeping the
 * schema payload lightweight and fast.
 */
export const CORE_WEBMCP_TOOL_NAMES: readonly string[] = [
  'create_new_project',
  'create_object',
  'update_transform',
  'update_renderer',
  'set_physics',
  'create_meadow',
  'create_water_volume',
  'set_scene_environment',
  'apply_lighting_preset',
  'set_blueprint_script',
  'set_character_controller',
  'set_vehicle',
  'list_scene',
  'set_playing',
];

/**
 * Gateway tools that allow the AI agent to dynamically discover and execute any of the
 * 200+ advanced Feather Engine tools without overloading the browser's context window.
 */
function buildGatewayTools(): WebMcpToolDefinition[] {
  const searchTool: WebMcpToolDefinition = {
    name: 'search_engine_tools',
    description:
      'Search across all 200+ advanced Feather Engine tools by keyword (e.g. "ragdoll", "joint", "cinematic", "audio", "ui", "particle", "timeline", "material", "prefab", "terrain", "vehicle"). Returns matching tool names, descriptions, and input parameters so you can call them using execute_engine_tool.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword, system, or feature to search for (e.g. "ragdoll", "camera", "water", "cloth", "score", "light"). Pass empty string or "categories" to list all categories.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tool definitions to return (default 8).',
        },
      },
      required: ['query'],
    },
    execute: async (rawInput: unknown): Promise<WebMcpToolExecutionResponse> => {
      const input = (rawInput ?? {}) as { query?: string; limit?: number };
      const q = (input.query ?? '').toLowerCase().trim();
      const limit = Math.max(1, Math.min(20, input.limit ?? 8));

      if (!q || q === 'categories' || q === 'list') {
        const categories = {
          '3D Scene & Objects': ['create_object', 'set_object_parent', 'duplicate_object', 'delete_object', 'list_scene', 'inspect_object'],
          'Physics, Ragdoll & Joints': ['set_physics', 'add_joint', 'set_ragdoll', 'set_ragdoll_body', 'generate_ragdoll_bodies', 'attach_to_socket'],
          'Characters, Controllers & Vehicles': ['set_character_controller', 'set_vehicle', 'customize_vehicle', 'set_anim_parameter'],
          'Nature, Terrain & Water': ['create_meadow', 'create_water_volume', 'apply_tree_preset', 'update_terrain_layer'],
          'Atmosphere, Lighting & Post-FX': ['set_scene_environment', 'apply_lighting_preset', 'apply_render_preset'],
          'Visual Scripting & Blueprints': ['set_blueprint_script', 'open_object_script', 'attach_blueprint', 'add_node', 'connect_nodes'],
          'Cinematics, Shots & Timeline': ['create_cinematic', 'add_cinematic_shot', 'add_cinematic_transition', 'set_cinematic_look', 'play_cinematic'],
          'UI, Menus & HUD': ['create_ui_document', 'add_ui_element', 'update_ui_element', 'set_ui_text', 'set_ui_binding'],
          'Materials, Shaders & Particles': ['create_material', 'set_object_material', 'add_particle_emitter', 'set_particle_system'],
          'Project & Play': ['create_new_project', 'create_scene', 'switch_scene', 'set_playing', 'fire_event', 'capture_screenshot'],
        };
        return {
          content: [
            {
              type: 'text',
              text:
                `Feather Engine Tool Catalog (${Object.keys(looseTools).length} total tools available in engine):\n` +
                JSON.stringify(categories, null, 2) +
                `\n\nRun search_engine_tools with a keyword (e.g. query: "ragdoll" or query: "cinematic") to see full tool schemas, then call execute_engine_tool.`,
            },
          ],
        };
      }

      const matches = Object.entries(looseTools)
        .filter(([name, def]) => {
          const desc = def.description?.toLowerCase() ?? '';
          return name.toLowerCase().includes(q) || desc.includes(q);
        })
        .slice(0, limit)
        .map(([name, def]) => {
          const schema = isZodSchema(def.inputSchema)
            ? (z.toJSONSchema(def.inputSchema, {
                io: 'input',
                unrepresentable: 'any',
                reused: 'inline',
              }) as Record<string, unknown>)
            : { type: 'object' };
          return {
            name,
            description: def.description ?? '',
            inputSchema: schema,
          };
        });

      return {
        content: [
          {
            type: 'text',
            text:
              matches.length > 0
                ? `Found ${matches.length} matching tool(s) for "${q}":\n` +
                  JSON.stringify(matches, null, 2) +
                  `\n\nYou can execute any of these tools right now using: execute_engine_tool({ toolName: "<name>", parameters: { ... } })`
                : `No tools matched "${q}". Available categories include: physics, ragdoll, joints, vehicle, cinematic, ui, audio, terrain, water, script, material.`,
          },
        ],
      };
    },
  };

  const executeTool: WebMcpToolDefinition = {
    name: 'execute_engine_tool',
    description:
      'Execute any advanced Feather Engine tool from the full 200+ tool catalog by name (e.g. tools discovered via search_engine_tools like add_joint, set_ragdoll, create_cinematic, add_cinematic_shot, create_ui_document, add_ui_element, customize_vehicle, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description:
            'The exact name of the engine tool to execute (from search_engine_tools or the engine tool catalog).',
        },
        parameters: {
          type: 'object',
          description: 'JSON dictionary of arguments for the specified tool.',
        },
      },
      required: ['toolName'],
    },
    execute: async (rawInput: unknown): Promise<WebMcpToolExecutionResponse> => {
      const input = (rawInput ?? {}) as {
        toolName?: string;
        parameters?: Record<string, unknown>;
      };
      if (!input.toolName) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error: "toolName" parameter is required.' }],
        };
      }

      const outcome = await useWebMcpStore
        .getState()
        .executeToolDirectly(input.toolName, input.parameters ?? {});
      if (!outcome.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error executing ${input.toolName}: ${outcome.error}`,
            },
          ],
        };
      }

      const serialized =
        typeof outcome.result === 'string'
          ? outcome.result
          : JSON.stringify(outcome.result, null, 2);

      return {
        content: [{ type: 'text', text: `[${input.toolName}] ${serialized}` }],
      };
    },
  };

  return [searchTool, executeTool];
}

/**
 * Derives JSON Schemas and prepares WebMCP-compliant tool definitions.
 */
export function buildWebMcpToolDefinitions(includeAll = false): WebMcpToolDefinition[] {
  const allowedSet = new Set(CORE_WEBMCP_TOOL_NAMES);
  const directTools = Object.entries(looseTools)
    .filter(([name, def]) => (includeAll || allowedSet.has(name)) && typeof def.execute === 'function')
    .map(([name, def]) => {
      const inputSchema = isZodSchema(def.inputSchema)
        ? (z.toJSONSchema(def.inputSchema, {
            io: 'input',
            unrepresentable: 'any',
            reused: 'inline',
          }) as Record<string, unknown>)
        : { type: 'object' };

      const description = def.description ?? `Feather Engine 3D tool: ${name}`;

      const execute = async (input: unknown): Promise<WebMcpToolExecutionResponse> => {
        const outcome = await useWebMcpStore.getState().executeToolDirectly(name, input);

        if (!outcome.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error: ${outcome.error}` }],
          };
        }

        const serialized =
          typeof outcome.result === 'string'
            ? outcome.result
            : JSON.stringify(outcome.result, null, 2);

        return {
          content: [{ type: 'text', text: serialized }],
        };
      };

      return {
        name,
        description,
        inputSchema,
        execute,
      };
    });

  const gatewayTools = buildGatewayTools();
  return [...directTools, ...gatewayTools];
}

declare global {
  interface Document {
    modelContext?: ModelContextInterface;
  }
  interface Window {
    modelContext?: ModelContextInterface;
    __featherWebMcp?: unknown;
  }
  interface Navigator {
    modelContext?: ModelContextInterface;
  }
}

function findModelContext(): ModelContextInterface | null {
  if (typeof window === 'undefined') return null;

  if (typeof document !== 'undefined' && document.modelContext && typeof document.modelContext.registerTool === 'function') {
    return document.modelContext;
  }

  const win = window as Window;
  if (win.modelContext && typeof win.modelContext.registerTool === 'function') {
    return win.modelContext;
  }

  const nav = window.navigator as Navigator;
  if (nav.modelContext && typeof nav.modelContext.registerTool === 'function') {
    return nav.modelContext;
  }

  return null;
}

let initialized = false;

/**
 * Initializes the WebMCP bridge in the browser.
 * Detects native browser WebMCP (Chrome #enable-webmcp-testing / ChatGPT in-app browser)
 * or provides a polyfill runtime for test consoles and simulator agents.
 */
export function initWebMcpBridge(): { registeredCount: number; isNative: boolean } {
  if (initialized) {
    const state = useWebMcpStore.getState();
    return { registeredCount: state.registeredTools.length, isNative: state.isNativeSupported };
  }
  initialized = true;

  const toolDefs = buildWebMcpToolDefinitions();
  const toolManifests: WebMcpToolManifest[] = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const nativeContext = findModelContext();
  const isNative = Boolean(nativeContext);

  if (typeof document !== 'undefined' && document.modelContext && typeof document.modelContext.registerTool === 'function') {
    let registeredCount = 0;
    for (const toolDef of toolDefs) {
      try {
        // W3C WebMCP Standard registration:
        document.modelContext.registerTool({
          name: toolDef.name,
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
          execute: toolDef.execute,
        });
        registeredCount += 1;
      } catch (err) {
        console.warn(`[WebMCP] Failed to register tool "${toolDef.name}":`, err);
      }
    }
    console.info(
      `[WebMCP] Native browser ModelContext detected: registered ${registeredCount} tools to document.modelContext`,
    );
  } else if (nativeContext && typeof nativeContext.registerTool === 'function') {
    let registeredCount = 0;
    for (const toolDef of toolDefs) {
      try {
        nativeContext.registerTool(toolDef);
        registeredCount += 1;
      } catch (err) {
        console.warn(`[WebMCP] Failed to register tool "${toolDef.name}":`, err);
      }
    }
    console.info(`[WebMCP] Browser ModelContext detected: registered ${registeredCount} tools`);
  } else {
    console.info(
      `[WebMCP] document.modelContext not detected in current browser. Built-in WebMCP simulator and test bridge active with ${toolDefs.length} tools. (To enable in Chrome: chrome://flags/#enable-webmcp-testing)`,
    );
  }

  useWebMcpStore.getState().setRegistered(true, toolManifests, isNative);

  // Expose global debug handle for inspectors, E2E runners, and agent testers
  if (typeof window !== 'undefined') {
    (window as unknown as { __featherWebMcp: unknown }).__featherWebMcp = {
      isNative,
      tools: toolManifests,
      execute: (toolName: string, input: unknown) =>
        useWebMcpStore.getState().executeToolDirectly(toolName, input),
      invoke: (toolName: string, input?: unknown) =>
        useWebMcpStore.getState().executeToolDirectly(toolName, input ?? {}),
      getStore: () => useWebMcpStore.getState(),
    };
  }

  return { registeredCount: toolDefs.length, isNative };
}
