import { useState } from 'react';
import { Bot, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { useWebMcpStore } from '../ai/webMcp';

export function WebMcpAgentBar() {
  const [minimized, setMinimized] = useState(false);

  const activeCall = useWebMcpStore((state) => state.activeCall);
  const callHistory = useWebMcpStore((state) => state.callHistory);
  const isRegistered = useWebMcpStore((state) => state.isRegistered);
  const showAgentBar = useWebMcpStore((state) => state.showAgentBar);

  const lastCall = callHistory[0];

  if (!isRegistered || !showAgentBar) return null;

  return (
    <div className={`webmcp-agent-bar-container ${minimized ? 'minimized' : ''}`}>
      <div className="webmcp-agent-card">
        <div className="webmcp-agent-card-top">
          <span className="webmcp-agent-headline">
            Ask an agent to shape a 3D scene, add physics, or script gameplay...
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
                <strong>Waiting for agent to invoke tools</strong>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
