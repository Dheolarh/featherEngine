import { useState, useRef, useEffect } from 'react';
import {
  X,
  Code2,
  Copy,
  Check,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { useWebMcpStore } from '../ai/webMcp';

const SAMPLE_TOOL_SNIPPETS: Record<string, string> = {
  create_object: `await window.__featherWebMcp.invoke(
  "create_object",
  {
    kind: "sphere",
    name: "Golden Sphere",
    position: [0, 5, 0],
    color: "#4ade80"
  }
);`,
  update_transform: `await window.__featherWebMcp.invoke(
  "update_transform",
  {
    id: "obj-1",
    position: [0, 3, 5],
    rotation: [0, 1.57, 0]
  }
);`,
  update_renderer: `await window.__featherWebMcp.invoke(
  "update_renderer",
  {
    objectId: "obj-1",
    color: "#38bdf8",
    roughness: 0.2,
    metalness: 0.8
  }
);`,
  set_physics: `await window.__featherWebMcp.invoke(
  "set_physics",
  {
    objectId: "obj-1",
    bodyType: "dynamic",
    collider: "sphere",
    restitution: 0.85
  }
);`,
  create_meadow: `await window.__featherWebMcp.invoke(
  "create_meadow",
  {
    density: 1.2,
    wildflowers: true,
    windStrength: 0.6
  }
);`,
  create_water_volume: `await window.__featherWebMcp.invoke(
  "create_water_volume",
  {
    position: [0, -1, 0],
    size: [60, 8, 60],
    waves: true
  }
);`,
  set_scene_environment: `await window.__featherWebMcp.invoke(
  "set_scene_environment",
  {
    fogDensity: 0.02,
    fogColor: "#182030",
    ambientColor: "#6ee7b7"
  }
);`,
  apply_lighting_preset: `await window.__featherWebMcp.invoke(
  "apply_lighting_preset",
  {
    preset: "cyberpunk"
  }
);`,
  set_character_controller: `await window.__featherWebMcp.invoke(
  "set_character_controller",
  {
    objectId: "hero-1",
    moveSpeed: 6.5,
    jumpStrength: 8.0,
    cameraFollow: true
  }
);`,
  set_vehicle: `await window.__featherWebMcp.invoke(
  "set_vehicle",
  {
    objectId: "car-1",
    maxSpeed: 45,
    gripFactor: 0.92,
    cameraFollow: true
  }
);`,
  list_scene: `await window.__featherWebMcp.invoke(
  "list_scene",
  {
    detail: "compact"
  }
);`,
  search_engine_tools: `await window.__featherWebMcp.invoke(
  "search_engine_tools",
  {
    query: "cinematic",
    limit: 5
  }
);`,
  execute_engine_tool: `await window.__featherWebMcp.invoke(
  "execute_engine_tool",
  {
    toolName: "add_joint",
    parameters: {
      type: "hinge",
      bodyAId: "obj-1",
      bodyBId: "obj-2"
    }
  }
);`,
};

const DEFAULT_SNIPPET = `await window.__featherWebMcp.invoke(
  "create_object",
  {
    kind: "sphere",
    name: "Golden-hour orb",
    position: [0, 4, 0],
    color: "#4ade80"
  }
);`;

export function WebMcpIndicator() {
  const [open, setOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>('create_object');
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isNative = useWebMcpStore((state) => state.isNativeSupported);
  const isRegistered = useWebMcpStore((state) => state.isRegistered);
  const registeredTools = useWebMcpStore((state) => state.registeredTools);
  const activeCall = useWebMcpStore((state) => state.activeCall);

  const toolCount = registeredTools.length;

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      window.addEventListener('mousedown', handleOutsideClick);
      return () => window.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [open]);

  const activeSnippet = SAMPLE_TOOL_SNIPPETS[selectedTool] ?? DEFAULT_SNIPPET;

  const copySnippet = () => {
    navigator.clipboard.writeText(activeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isReadOnlyTool = (name: string) =>
    ['list_scene', 'inspect_object', 'search_engine_tools'].includes(name);

  return (
    <div className="webmcp-indicator-wrapper" ref={popoverRef}>
      <button
        className={`webmcp-pill ${activeCall ? 'active' : isRegistered ? 'ready' : 'inactive'}`}
        onClick={() => setOpen((prev) => !prev)}
        title="WebMCP: Browser-native AI agent tool bridge"
      >
        <span className="webmcp-status-dot" />
        <span className="webmcp-pill-label">
          {activeCall ? (
            <>Agent Working...</>
          ) : isRegistered ? (
            <>WebMCP {toolCount} tools</>
          ) : (
            <>WebMCP Initializing</>
          )}
        </span>
        <ChevronDown size={13} className={`webmcp-pill-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="webmcp-wn-popover">
          {/* Header area */}
          <div className="webmcp-wn-header">
            <div className="webmcp-wn-header-left">
              <h2 className="webmcp-wn-title">
                Engine <em>WebMCP</em> Tools
              </h2>
              <span className="webmcp-wn-tool-count-badge">{toolCount} tools</span>
            </div>
            <button
              className="webmcp-wn-close"
              onClick={() => setOpen(false)}
              title="Close WebMCP details"
              aria-label="Close WebMCP details"
            >
              <X size={15} />
            </button>
          </div>

          <p className="webmcp-wn-desc">
            An agent can inspect your scene, spawn 3D objects, configure physics, and build the world right here.
          </p>

          {/* Tool list card */}
          <div className="webmcp-wn-tool-list">
            {registeredTools.map((tool) => {
              const readOnly = isReadOnlyTool(tool.name);
              const isSelected = selectedTool === tool.name;
              return (
                <div
                  key={tool.name}
                  className={`webmcp-wn-tool-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedTool(tool.name)}
                >
                  <div className="webmcp-wn-tool-icon">
                    <Code2 size={13} />
                  </div>
                  <div className="webmcp-wn-tool-info">
                    <div className="webmcp-wn-tool-header">
                      <span className="webmcp-wn-tool-name">{tool.name}</span>
                      {readOnly && <span className="webmcp-wn-readonly-badge">read only</span>}
                    </div>
                    <p className="webmcp-wn-tool-desc">{tool.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Try a little agent magic code box */}
          <div className="webmcp-wn-code-section">
            <div className="webmcp-wn-code-header">
              <span className="webmcp-wn-code-eyebrow">TRY A LITTLE AGENT MAGIC</span>
              <button className="webmcp-wn-copy-btn" onClick={copySnippet} title="Copy code snippet">
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="webmcp-wn-code-block">
              <code>{activeSnippet}</code>
            </pre>
          </div>

          {/* Footer note */}
          <div className="webmcp-wn-footer">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Human edits are always protected.</span>
          </div>
        </div>
      )}
    </div>
  );
}
