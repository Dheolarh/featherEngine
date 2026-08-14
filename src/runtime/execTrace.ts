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
};

export function markExec(nodeId: string) {
  if (!execTrace.enabled) return;
  execTrace.nodes.set(nodeId, performance.now());
  execTrace.counts.set(nodeId, (execTrace.counts.get(nodeId) ?? 0) + 1);
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
  }
}
