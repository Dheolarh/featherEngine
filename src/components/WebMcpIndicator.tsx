import { useState, useRef, useEffect } from 'react';
import { Sparkles, Check, Copy, Activity, Terminal, ChevronDown, Wrench } from 'lucide-react';
import { useWebMcpStore } from '../ai/webMcp';

const SAMPLE_PROMPTS = [
  'Build a neon obstacle course with bouncy platforms and low gravity',
  'Create an interactive meadow with wind, wildflowers, and swaying trees',
  'Spawn a water volume with realistic Gerstner waves and floating crates',
  'Set up a physics lab with dominoes and a rolling sphere',
];

export function WebMcpIndicator() {
  const [open, setOpen] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isNative = useWebMcpStore((state) => state.isNativeSupported);
  const isRegistered = useWebMcpStore((state) => state.isRegistered);
  const registeredTools = useWebMcpStore((state) => state.registeredTools);
  const activeCall = useWebMcpStore((state) => state.activeCall);
  const totalCalls = useWebMcpStore((state) => state.totalCalls);
  const callHistory = useWebMcpStore((state) => state.callHistory);

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

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopiedPrompt(prompt);
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

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
        <div className="webmcp-popover">
          <div className="webmcp-popover-header">
            <div className="webmcp-header-title">
              <Sparkles size={16} className="text-emerald-400" />
              <strong>WebMCP Browser Bridge</strong>
            </div>
            <span className={`webmcp-badge ${isNative ? 'native' : 'emulated'}`}>
              {isNative ? '● Native W3C WebMCP' : '● Browser Standard Ready'}
            </span>
          </div>

          <p className="webmcp-popover-desc">
            This 3D engine exposes <strong>{toolCount} tools</strong> directly to visiting browser agents
            via <code>document.modelContext</code>.
          </p>

          <div className="webmcp-stats-grid">
            <div className="webmcp-stat">
              <span className="stat-label">Registered Tools</span>
              <span className="stat-value">{toolCount}</span>
            </div>
            <div className="webmcp-stat">
              <span className="stat-label">Agent Calls</span>
              <span className="stat-value">{totalCalls}</span>
            </div>
            <div className="webmcp-stat">
              <span className="stat-label">Status</span>
              <span className="stat-value text-emerald-400">
                {activeCall ? 'Executing...' : 'Listening'}
              </span>
            </div>
          </div>

          <div className="webmcp-section-title">
            <Terminal size={13} />
            <span>Copy prompts for ChatGPT / Chrome</span>
          </div>

          <div className="webmcp-prompts-list">
            {SAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className="webmcp-prompt-chip"
                onClick={() => copyPrompt(prompt)}
                title="Click to copy for ChatGPT"
              >
                <span className="prompt-text">"{prompt}"</span>
                {copiedPrompt === prompt ? (
                  <Check size={13} className="text-emerald-400 shrink-0" />
                ) : (
                  <Copy size={13} className="text-zinc-400 shrink-0" />
                )}
              </button>
            ))}
          </div>

          {callHistory.length > 0 && (
            <>
              <div className="webmcp-section-title mt-3">
                <Activity size={13} />
                <span>Recent Agent Invocations</span>
              </div>
              <div className="webmcp-recent-calls">
                {callHistory.slice(0, 4).map((call) => (
                  <div key={call.id} className="webmcp-call-item">
                    <Wrench size={12} className="text-zinc-400" />
                    <span className="call-name">{call.tool}</span>
                    <span className="call-time">{call.durationMs}ms</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
