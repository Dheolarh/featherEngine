import { useState, useEffect } from 'react';
import { Bot, Check, Copy, Sparkles, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useWebMcpStore } from '../ai/webMcp';

const STARTER_PROMPTS = [
  'Build a neon obstacle course with bouncy platforms and low gravity',
  'Create a lush meadow with swaying grass, wildflowers, and trees',
  'Spawn a water volume with realistic waves and floating crates',
];

export function WebMcpAgentBar() {
  const [minimized, setMinimized] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  const activeCall = useWebMcpStore((state) => state.activeCall);
  const callHistory = useWebMcpStore((state) => state.callHistory);
  const lastTool = useWebMcpStore((state) => state.lastToolExecuted);
  const isRegistered = useWebMcpStore((state) => state.isRegistered);
  const toolCount = useWebMcpStore((state) => state.registeredTools.length);

  const lastCall = callHistory[0];

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopiedPrompt(prompt);
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

  if (!isRegistered) return null;

  return (
    <div className={`webmcp-agent-bar-container ${minimized ? 'minimized' : ''}`}>
      <div className="webmcp-agent-card">
        <div className="webmcp-agent-card-top">
          <span className="webmcp-agent-headline">
            Ask an agent in ChatGPT or Chrome to shape a 3D scene, add physics, or script gameplay...
          </span>
          <button
            className="webmcp-minimize-btn"
            onClick={() => setMinimized((prev) => !prev)}
            title={minimized ? 'Expand' : 'Collapse'}
          >
            {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {!minimized && (
          <>
            <div className="webmcp-agent-card-status">
              {activeCall ? (
                <div className="status-row active">
                  <span className="status-pulse-dot" />
                  <strong>Agent Working</strong>
                  <span className="status-sep">·</span>
                  <span className="status-detail">
                    Executing <code>{activeCall.tool}</code>...
                  </span>
                </div>
              ) : lastCall ? (
                <div className="status-row complete">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <strong>Agent Operation Complete</strong>
                  <span className="status-sep">·</span>
                  <span className="status-detail">
                    {lastCall.isError
                      ? `Failed on ${lastCall.tool}: ${lastCall.error ?? 'error'}`
                      : `Successfully ran ${lastCall.tool} (${lastCall.durationMs}ms)`}
                  </span>
                </div>
              ) : (
                <div className="status-row waiting">
                  <Bot size={14} className="text-amber-400 shrink-0" />
                  <strong>Waiting for an agent</strong>
                  <span className="status-sep">·</span>
                  <span className="status-detail">
                    Waiting for an agent to invoke its first browser-local 3D tool ({toolCount} tools ready).
                  </span>
                </div>
              )}
            </div>

            <div className="webmcp-agent-quick-prompts">
              <span className="prompts-label">Try asking:</span>
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="quick-prompt-btn"
                  onClick={() => copyPrompt(prompt)}
                  title="Click to copy for ChatGPT"
                >
                  <span>"{prompt}"</span>
                  {copiedPrompt === prompt ? (
                    <Check size={12} className="text-emerald-400 shrink-0" />
                  ) : (
                    <Copy size={12} className="text-zinc-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
