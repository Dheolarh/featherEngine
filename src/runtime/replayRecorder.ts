import type { SceneObject } from '../types';
import type { BufferedTransform } from './transformBuffer';

/**
 * Instant-replay recorder — a fixed-rate ring buffer of pure RENDER-STATE snapshots.
 *
 * Ported in spirit from MomentumCup's src/replay/replay.ts. While Play runs, `captureReplayFrame`
 * writes every tracked object's transform (position/rotation/scale) into a ring buffer at a fixed
 * REPLAY_HZ (independent of the render/tick rate). `beginReplay` slices the last N seconds into an
 * active clip; `sampleActiveReplay(t)` interpolates between the two bracketing frames at render time.
 *
 * Nothing here touches physics or the Zustand store: playback works purely by overriding the render
 * transform buffer (see transformBuffer.ts `publishRenderTransforms`), the same channel physics
 * smoothing uses. So a replay is a visual rewind only — no deterministic re-simulation required.
 *
 * All hot paths are allocation-free: ring slots and the playback output map are reused. `beginReplay`
 * is the only allocator (it slices the window once when a replay is triggered).
 */

const REPLAY_HZ = 30;
const BUFFER_SECONDS = 8;
/** Cap tracked objects so a huge scene can't blow up the buffer (128 × 10 floats × 240 frames ≈ 1.2MB). */
const MAX_TRACKED = 128;
const HEADER = 1; // [time]
const SLOT = 10; // posX,posY,posZ, rotX,rotY,rotZ, sclX,sclY,sclZ, present

const CAPACITY = REPLAY_HZ * BUFFER_SECONDS;

// ---- Ring-buffer state (module-level, like transformBuffer/navCache — never stored in React) ------
let frames: Float32Array[] = [];
let head = 0; // next write index
let count = 0; // valid frames
let lastCaptureAt = -Infinity;
let slotIds: string[] = [];
let slotIndex = new Map<string, number>();
let stride = HEADER; // HEADER + slotIds.length * SLOT

// ---- Active-clip state (set while a replay is playing back) ---------------------------------------
let activeClip: ReplayClip | null = null;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Prepare the recorder for a fresh Play session: fix the slot table from the current object set and
 * clear the ring. Dynamic objects (physics/character/scripted) are tracked FIRST so that when a scene
 * has more than MAX_TRACKED objects the moving ones are the ones that get recorded. Runtime-spawned
 * objects (projectiles etc.) are not tracked — the slot table is fixed at Play start (v1 limitation).
 */
export const resetReplayRecorder = (objects: SceneObject[]) => {
  const dynamic: string[] = [];
  const stat: string[] = [];
  for (const o of objects) {
    (o.physics?.enabled || o.character?.enabled || o.script?.enabled ? dynamic : stat).push(o.id);
  }
  slotIds = [...dynamic, ...stat].slice(0, MAX_TRACKED);
  slotIndex = new Map(slotIds.map((id, i) => [id, i]));
  stride = HEADER + slotIds.length * SLOT;
  frames = [];
  head = 0;
  count = 0;
  lastCaptureAt = -Infinity;
  activeClip = null;
};

/**
 * Drop buffered frames + any active clip but KEEP the slot table, so recording resumes for the same
 * object set. Used on a floating-origin rebase, where every transform shifts by a 1024-snap offset and
 * the buffered (old-coordinate) frames would otherwise replay at the wrong world position.
 */
export const resetReplayBuffer = () => {
  frames = [];
  head = 0;
  count = 0;
  lastCaptureAt = -Infinity;
  activeClip = null;
};

/** Clear everything on Stop so a new run doesn't read stale frames. */
export const clearReplayRecorder = () => {
  frames = [];
  head = 0;
  count = 0;
  lastCaptureAt = -Infinity;
  slotIds = [];
  slotIndex = new Map();
  stride = HEADER;
  activeClip = null;
};

/**
 * Ring write, throttled to REPLAY_HZ against the runtime clock (which already respects the Set Time
 * Scale node, so a paused/slow-mo game records at the right rate). Allocation-free after warm-up.
 */
export const captureReplayFrame = (objects: SceneObject[], now: number) => {
  if (slotIds.length === 0) return;
  if (now - lastCaptureAt < 1 / REPLAY_HZ - 1e-4) return;
  lastCaptureAt = now;

  // Index this frame's objects once, then fill each fixed slot.
  const byId = new Map<string, SceneObject>();
  for (const o of objects) {
    if (slotIndex.has(o.id)) byId.set(o.id, o);
  }

  const frame = (frames[head] ??= new Float32Array(stride));
  frame[0] = now;
  for (let i = 0; i < slotIds.length; i++) {
    const base = HEADER + i * SLOT;
    const o = byId.get(slotIds[i]);
    if (o) {
      const { position: p, rotation: r, scale: s } = o.transform;
      frame[base] = p[0];
      frame[base + 1] = p[1];
      frame[base + 2] = p[2];
      frame[base + 3] = r[0];
      frame[base + 4] = r[1];
      frame[base + 5] = r[2];
      frame[base + 6] = s[0];
      frame[base + 7] = s[1];
      frame[base + 8] = s[2];
      frame[base + 9] = 1; // present
    } else {
      frame[base + 9] = 0; // absent this frame (despawned / not yet spawned)
    }
  }

  head = (head + 1) % CAPACITY;
  if (count < CAPACITY) count += 1;
};

/** Frames in chronological (oldest → newest) order. */
const chronological = (): Float32Array[] => {
  const out: Float32Array[] = [];
  const start = (head - count + CAPACITY) % CAPACITY;
  for (let k = 0; k < count; k++) out.push(frames[(start + k) % CAPACITY]);
  return out;
};

/**
 * A sliced, self-contained window of frames plus a reusable output map. `sample(t)` interpolates the
 * two frames bracketing `t` (t in [0, duration]) and returns the shared map — pass straight to
 * publishRenderTransforms.
 */
export class ReplayClip {
  readonly duration: number;
  private readonly out = new Map<string, BufferedTransform>();

  constructor(
    private readonly clipFrames: Float32Array[],
    private readonly ids: string[],
    private readonly t0: number,
  ) {
    this.duration = clipFrames[clipFrames.length - 1][0] - t0;
    for (const id of ids) this.out.set(id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  }

  sample(t: number): Map<string, BufferedTransform> {
    const target = this.t0 + clamp(t, 0, this.duration);
    const f = this.clipFrames;
    let hi = 1;
    while (hi < f.length && f[hi][0] < target) hi++;
    if (hi >= f.length) hi = f.length - 1;
    const a = f[hi - 1];
    const b = f[hi];
    const span = b[0] - a[0];
    const k = span > 1e-5 ? (target - a[0]) / span : 0;

    // Rebuild the output map to only hold objects present in BOTH bracketing frames, so a despawned
    // object isn't teleported to the origin (present=0 → skip; it simply isn't overridden this frame).
    this.out.clear();
    for (let i = 0; i < this.ids.length; i++) {
      const base = HEADER + i * SLOT;
      if (a[base + 9] < 0.5 || b[base + 9] < 0.5) continue;
      const bt: BufferedTransform = {
        position: [
          a[base] + (b[base] - a[base]) * k,
          a[base + 1] + (b[base + 1] - a[base + 1]) * k,
          a[base + 2] + (b[base + 2] - a[base + 2]) * k,
        ],
        rotation: [
          a[base + 3] + (b[base + 3] - a[base + 3]) * k,
          a[base + 4] + (b[base + 4] - a[base + 4]) * k,
          a[base + 5] + (b[base + 5] - a[base + 5]) * k,
        ],
        scale: [
          a[base + 6] + (b[base + 6] - a[base + 6]) * k,
          a[base + 7] + (b[base + 7] - a[base + 7]) * k,
          a[base + 8] + (b[base + 8] - a[base + 8]) * k,
        ],
      };
      this.out.set(this.ids[i], bt);
    }
    return this.out;
  }
}

/**
 * Slice the last `seconds` of recorded motion into an active clip and return its duration, or null if
 * there isn't enough buffered yet (needs ≥ 2 frames spanning some time). `now` is the runtime clock.
 */
export const beginReplay = (now: number, seconds = BUFFER_SECONDS): number | null => {
  const threshold = now - Math.min(seconds, BUFFER_SECONDS);
  const window = chronological().filter((frame) => frame[0] >= threshold);
  if (window.length < 2) return null;
  const t0 = window[0][0];
  if (window[window.length - 1][0] - t0 < 1e-3) return null;
  // Copy the window so the live ring can keep overwriting slots while the clip plays back.
  const copied = window.map((frame) => frame.slice());
  activeClip = new ReplayClip(copied, slotIds.slice(), t0);
  return activeClip.duration;
};

/** Interpolated poses for the active clip at local time `t`, or null if no replay is active. */
export const sampleActiveReplay = (t: number): Map<string, BufferedTransform> | null =>
  activeClip ? activeClip.sample(t) : null;

/** Drop the active clip (playback finished or cancelled). The ring buffer is untouched. */
export const endReplay = () => {
  activeClip = null;
};
