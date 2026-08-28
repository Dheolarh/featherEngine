import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebMcpToolDefinitions,
  initWebMcpBridge,
  useWebMcpStore,
  type WebMcpToolDefinition,
} from '../webMcp';
import { useEditorStore } from '../../store/editorStore';

describe('WebMCP Core Bridge', () => {
  beforeEach(() => {
    useWebMcpStore.getState().clearHistory();
    // Reset editor store to a clean state
    useEditorStore.setState((state) => ({
      ...state,
      scenes: [
        {
          id: 'scene-1',
          name: 'Main Scene',
          objects: [],
        },
      ],
      activeSceneId: 'scene-1',
      selectedObjectIds: [],
    }));
  });

  it('generates valid WebMCP tool definitions and JSON schemas from engineTools', () => {
    const tools = buildWebMcpToolDefinitions();
    expect(tools.length).toBe(16);
    expect(buildWebMcpToolDefinitions(true).length).toBeGreaterThan(50);

    // Verify key 3D engine tools and gateways are present
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('create_new_project');
    expect(toolNames).toContain('list_scene');
    expect(toolNames).toContain('create_object');
    expect(toolNames).toContain('update_transform');
    expect(toolNames).toContain('update_renderer');
    expect(toolNames).toContain('set_physics');
    expect(toolNames).toContain('set_scene_environment');
    expect(toolNames).toContain('set_blueprint_script');
    expect(toolNames).toContain('search_engine_tools');
    expect(toolNames).toContain('execute_engine_tool');

    // Verify schema structure on create_object
    const createObjectTool = tools.find((t) => t.name === 'create_object');
    expect(createObjectTool).toBeDefined();
    expect(createObjectTool?.description).toBeTruthy();
    expect(createObjectTool?.inputSchema).toHaveProperty('type', 'object');
  });

  it('registers all tools onto document.modelContext when native API is detected', () => {
    const registered: WebMcpToolDefinition[] = [];
    const mockModelContext = {
      registerTool: vi.fn((toolDef: WebMcpToolDefinition) => {
        registered.push(toolDef);
      }),
    };

    // Attach mock to document
    const doc = window.document as unknown as { modelContext?: unknown };
    doc.modelContext = mockModelContext;

    // Reset initialization
    useWebMcpStore.setState({ isRegistered: false, registeredTools: [] });

    const result = initWebMcpBridge();
    expect(result.registeredCount).toBe(16);
    expect(mockModelContext.registerTool).toHaveBeenCalled();
    expect(registered.length).toBe(result.registeredCount);

    const storeState = useWebMcpStore.getState();
    expect(storeState.isRegistered).toBe(true);
    expect(storeState.registeredTools.length).toBe(result.registeredCount);

    // Clean up
    delete doc.modelContext;
  });

  it('executes list_scene tool and formats content response', async () => {
    const tools = buildWebMcpToolDefinitions();
    const listSceneTool = tools.find((t) => t.name === 'list_scene');
    expect(listSceneTool).toBeDefined();

    const response = await listSceneTool!.execute({ detail: 'compact' });
    expect(response.isError).toBeFalsy();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');

    const history = useWebMcpStore.getState().callHistory;
    expect(history).toHaveLength(1);
    expect(history[0].tool).toBe('list_scene');
    expect(history[0].isError).toBe(false);
  });

  it('executes create_object tool, mutates the 3D scene store, and records telemetry', async () => {
    const tools = buildWebMcpToolDefinitions();
    const createObjectTool = tools.find((t) => t.name === 'create_object');
    expect(createObjectTool).toBeDefined();

    const response = await createObjectTool!.execute({
      kind: 'cube',
      name: 'WebMcpTestCube',
      position: [0, 2, 0],
      color: '#ff0055',
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('WebMcpTestCube');

    // Verify object was actually spawned in the active Zustand scene
    const activeScene = useEditorStore
      .getState()
      .scenes.find((s) => s.id === useEditorStore.getState().activeSceneId);
    const cube = activeScene?.objects.find((o) => o.name === 'WebMcpTestCube');
    expect(cube).toBeDefined();
    expect(cube?.transform.position).toEqual([0, 2, 0]);

    // Verify store telemetry
    const state = useWebMcpStore.getState();
    expect(state.totalCalls).toBe(1);
    expect(state.totalErrors).toBe(0);
    expect(state.lastToolExecuted).toBe('create_object');
  });

  it('handles invalid input gracefully and reports errors in the MCP format', async () => {
    const tools = buildWebMcpToolDefinitions();
    const updateTransformTool = tools.find((t) => t.name === 'update_transform');
    expect(updateTransformTool).toBeDefined();

    // Pass invalid transform parameter (position must be vector3)
    const response = await updateTransformTool!.execute({
      id: 'invalid-id',
      position: 'not-an-array' as unknown as [number, number, number],
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Validation error');

    const state = useWebMcpStore.getState();
    expect(state.totalErrors).toBe(1);
    expect(state.callHistory[0].isError).toBe(true);
  });

  it('searches the engine tool catalog via search_engine_tools gateway', async () => {
    const tools = buildWebMcpToolDefinitions();
    const searchTool = tools.find((t) => t.name === 'search_engine_tools');
    expect(searchTool).toBeDefined();

    // 1. Search for cinematics
    const response = await searchTool!.execute({ query: 'cinematic' });
    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('create_cinematic');

    // 2. Search categories
    const catResponse = await searchTool!.execute({ query: 'categories' });
    expect(catResponse.content[0].text).toContain('Feather Engine Tool Catalog');
  });

  it('executes arbitrary advanced engine tools via execute_engine_tool gateway', async () => {
    const tools = buildWebMcpToolDefinitions();
    const execTool = tools.find((t) => t.name === 'execute_engine_tool');
    expect(execTool).toBeDefined();

    // Execute create_object through the gateway
    const response = await execTool!.execute({
      toolName: 'create_object',
      parameters: {
        kind: 'sphere',
        name: 'GatewaySpawnedSphere',
        position: [0, 5, 0],
      },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('GatewaySpawnedSphere');

    const activeScene = useEditorStore
      .getState()
      .scenes.find((s) => s.id === useEditorStore.getState().activeSceneId);
    const sphere = activeScene?.objects.find((o) => o.name === 'GatewaySpawnedSphere');
    expect(sphere).toBeDefined();
  });
});
