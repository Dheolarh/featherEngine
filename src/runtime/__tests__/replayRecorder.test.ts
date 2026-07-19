import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneObject } from '../../types';
import {
  resetReplayRecorder,
  clearReplayRecorder,
  captureReplayFrame,
  beginReplay,
  sampleActiveReplay,
  endReplay,
} from '../replayRecorder';

// Minimal SceneObject stand-in: the recorder only reads id, transform, and the physics/character/script
// flags (for slot-priority ordering). Cast through unknown to skip the rest of the shape.
const obj = (id: string, x: number, dynamic = true): SceneObject =>
  ({
    id,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...(dynamic ? { physics: { enabled: true } } : {}),
  }) as unknown as SceneObject;

describe('replayRecorder', () => {
  beforeEach(() => clearReplayRecorder());

  it('interpolates between recorded frames', () => {
    resetReplayRecorder([obj('A', 0)]);
    // posX tracks time*100; capture at 30Hz-spaced instants so the throttle lets each through.
    captureReplayFrame([obj('A', 0)], 0);
    captureReplayFrame([obj('A', 10)], 0.1);
    captureReplayFrame([obj('A', 20)], 0.2);

    const duration = beginReplay(0.2, 8);
    expect(duration).toBeCloseTo(0.2, 5);

    // Exact frame hit.
    expect(sampleActiveReplay(0.1)!.get('A')!.position[0]).toBeCloseTo(10, 3);
    // Halfway between frame@0 (0) and frame@0.1 (10).
    expect(sampleActiveReplay(0.05)!.get('A')!.position[0]).toBeCloseTo(5, 3);
    // Clamped past the end.
    expect(sampleActiveReplay(99)!.get('A')!.position[0]).toBeCloseTo(20, 3);
    endReplay();
  });

  it('throttles captures to ~30Hz', () => {
    resetReplayRecorder([obj('A', 0)]);
    captureReplayFrame([obj('A', 0)], 0);
    captureReplayFrame([obj('A', 5)], 0.01); // too soon — dropped
    captureReplayFrame([obj('A', 10)], 0.1); // accepted
    // Only two frames landed, spanning 0..0.1.
    expect(beginReplay(0.1, 8)).toBeCloseTo(0.1, 5);
  });

  it('returns null when too little motion is buffered', () => {
    resetReplayRecorder([obj('A', 0)]);
    captureReplayFrame([obj('A', 0)], 0);
    expect(beginReplay(0, 8)).toBeNull(); // single frame → no clip
  });

  it('keeps only the most recent window when the ring wraps', () => {
    resetReplayRecorder([obj('A', 0)]);
    // 8s buffer @ 30Hz = 240 slots; push 400 frames so the ring wraps well past capacity.
    for (let i = 0; i < 400; i++) captureReplayFrame([obj('A', i)], i * 0.1);
    const now = 399 * 0.1;
    // Ask for the last 2s → clip spans ~2s, and the newest sample reflects the newest frame's position.
    const duration = beginReplay(now, 2)!;
    expect(duration).toBeGreaterThan(1.5);
    expect(duration).toBeLessThanOrEqual(2.01);
    expect(sampleActiveReplay(duration)!.get('A')!.position[0]).toBeCloseTo(399, 0);
    endReplay();
  });

  it('skips an object that is absent (despawned) in a bracketing frame', () => {
    resetReplayRecorder([obj('A', 0)]);
    captureReplayFrame([obj('A', 0)], 0);
    captureReplayFrame([], 0.1); // A absent → present=0 this frame
    captureReplayFrame([], 0.2);
    beginReplay(0.2, 8);
    // Sampling in the absent region must NOT teleport A to the origin — it's simply not in the map.
    expect(sampleActiveReplay(0.15)!.has('A')).toBe(false);
    endReplay();
  });
});
