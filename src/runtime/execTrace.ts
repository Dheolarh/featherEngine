/**
 * Live execution trace for the blueprint editor's flow visualization (Unreal-style "wires pulse
 * while they execute"). The runtime tick marks every exec node it runs; the node editor polls the
 * map while Play is active and highlights recently-executed nodes/wires.
 *
 * A plain module singleton (like `mouseLook`) so the per-node marking never touches the Zustand
 * store. Recording only happens while `enabled` — the VisualScriptingPanel switches it on when a
 * graph editor is open during Play, so shipped games and headless ticks pay nothing.
 */
export const execTrace = {
  enabled: false,
  /** nodeId → performance.now() timestamp of its most recent execution. */
  nodes: new Map<string, number>(),
  /** nodeId → executions since the last panel poll window (cleared by resetExecWindowCounts). */
  counts: new Map<string, number>(),
  /** Nodes the user has flagged to pause Play on. Lives here rather than in the store so the hot
   *  per-node check below is a plain Set lookup with no subscription cost. */
  breakpoints: new Set<string>(),
  /** Set by markExec the moment a breakpoint node runs; the runtime tick reads it at the end of the
   *  same frame and pauses, so Play stops on the marked node rather than several frames past it. */
  hit: null as string | null,
};

export function markExec(nodeId: string) {
  // Breakpoints are checked BEFORE the `enabled` gate. `enabled` only turns on while the graph
  // editor is open, but a breakpoint must still fire when it isn't — the editor auto-reveals on a
  // hit, which is useless if the hit can only happen once the editor is already showing. The cost
  // is a size check that short-circuits to nothing for every project with no breakpoints set.
  // First breakpoint of the frame wins, so the editor highlights where it actually stopped rather
  // than the last node that happened to run.
  if (execTrace.hit === null && execTrace.breakpoints.size > 0 && execTrace.breakpoints.has(nodeId)) {
    execTrace.hit = nodeId;
  }
  if (!execTrace.enabled) return;
  execTrace.nodes.set(nodeId, performance.now());
  execTrace.counts.set(nodeId, (execTrace.counts.get(nodeId) ?? 0) + 1);
}

/** Toggle a breakpoint. Returns the new state so callers can render without re-reading. */
export function toggleBreakpoint(nodeId: string): boolean {
  if (execTrace.breakpoints.delete(nodeId)) return false;
  execTrace.breakpoints.add(nodeId);
  return true;
}

/** Consume the pending breakpoint hit (returns it and clears the flag). */
export function takeExecHit(): string | null {
  const hit = execTrace.hit;
  execTrace.hit = null;
  return hit;
}

/** Snapshot helper: clear per-window hit counts after the editor has read them. */
export function resetExecWindowCounts() {
  execTrace.counts.clear();
}

export function setExecTraceEnabled(enabled: boolean) {
  execTrace.enabled = enabled;
  if (!enabled) {
    execTrace.nodes.clear();
    execTrace.counts.clear();
    // Breakpoints deliberately survive — they are authored state, not trace data, so stopping Play
    // must not silently discard where the user asked to stop.
    execTrace.hit = null;
  }
}
