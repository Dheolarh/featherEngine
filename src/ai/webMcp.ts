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
 * Derives JSON Schemas and prepares WebMCP-compliant tool definitions for all engineTools.
 */
export function buildWebMcpToolDefinitions(): WebMcpToolDefinition[] {
  return Object.entries(looseTools)
    .filter(([, def]) => typeof def.execute === 'function')
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
      getStore: () => useWebMcpStore.getState(),
    };
  }

  return { registeredCount: toolDefs.length, isNative };
}
