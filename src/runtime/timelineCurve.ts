import type { TimelineCurveKey } from '../types';

export type TimelineCurvePreset = 'smooth' | 'linear' | 'easeIn' | 'easeOut';

const finite = (value: unknown, fallback: number): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const key = (
  id: string,
  time: number,
  value: number,
  interpolation: TimelineCurveKey['interpolation'],
  inTangent?: number,
  outTangent?: number,
): TimelineCurveKey => ({ id, time, value, interpolation, inTangent, outTangent });

/** Built-in curve shapes used by the Timeline editor and for terse FeatherScript authoring. */
export const timelineCurvePreset = (preset: TimelineCurvePreset): TimelineCurveKey[] => {
  if (preset === 'linear') {
    return [key('curve-start', 0, 0, 'linear'), key('curve-end', 1, 1, 'linear')];
  }
  if (preset === 'easeIn') {
    return [key('curve-start', 0, 0, 'cubic', 0, 0), key('curve-end', 1, 1, 'cubic', 2, 2)];
  }
  if (preset === 'easeOut') {
    return [key('curve-start', 0, 0, 'cubic', 2, 2), key('curve-end', 1, 1, 'cubic', 0, 0)];
  }
  return [key('curve-start', 0, 0, 'cubic', 0, 0), key('curve-end', 1, 1, 'cubic', 0, 0)];
};

export const DEFAULT_TIMELINE_CURVE: TimelineCurveKey[] = timelineCurvePreset('smooth');

/**
 * Sanitize curve data loaded from projects/scripts. Keys are sorted, times are clamped to 0..1,
 * ids are made unique, and malformed/empty curves fall back to a smooth two-key animation.
 */
export function normalizeTimelineCurve(keys: readonly TimelineCurveKey[] | undefined): TimelineCurveKey[] {
  if (!Array.isArray(keys) || keys.length === 0) return timelineCurvePreset('smooth');
  const ids = new Set<string>();
  const normalized = keys
    .map((item, index): TimelineCurveKey | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      let id = typeof item.id === 'string' && item.id ? item.id : `curve-key-${index}`;
      while (ids.has(id)) id = `${id}-${index}`;
      ids.add(id);
      const interpolation =
        item.interpolation === 'hold' || item.interpolation === 'linear' || item.interpolation === 'cubic'
          ? item.interpolation
          : 'cubic';
      return {
        id,
        time: Math.min(1, Math.max(0, finite(item.time, index ? 1 : 0))),
        value: finite(item.value, index ? 1 : 0),
        interpolation,
        ...(item.inTangent === undefined ? {} : { inTangent: finite(item.inTangent, 0) }),
        ...(item.outTangent === undefined ? {} : { outTangent: finite(item.outTangent, 0) }),
      };
    })
    .filter((item): item is TimelineCurveKey => Boolean(item))
    .sort((a, b) => a.time - b.time);

  if (normalized.length === 0) return timelineCurvePreset('smooth');
  if (normalized.length === 1) {
    const only = normalized[0];
    const otherTime = only.time < 0.5 ? 1 : 0;
    normalized.push({ ...only, id: `${only.id}-end`, time: otherTime });
    normalized.sort((a, b) => a.time - b.time);
  }
  return normalized;
}

export function sampleLegacyEasing(
  t: number,
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' = 'easeInOut',
): number {
  const u = Math.min(1, Math.max(0, t));
  if (easing === 'linear') return u;
  if (easing === 'easeIn') return u * u;
  if (easing === 'easeOut') return 1 - (1 - u) * (1 - u);
  return u * u * (3 - 2 * u);
}

/** Sample a Timeline curve. Missing curves retain the legacy Tween easing behavior. */
export function sampleTimelineCurve(
  keys: readonly TimelineCurveKey[] | undefined,
  t: number,
  fallbackEasing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' = 'easeInOut',
): number {
  if (!keys?.length) return sampleLegacyEasing(t, fallbackEasing);
  const sorted = normalizeTimelineCurve(keys);
  const u = Math.min(1, Math.max(0, t));
  if (u <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (u >= last.time) return last.value;

  let rightIndex = 1;
  while (rightIndex < sorted.length && sorted[rightIndex].time < u) rightIndex += 1;
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const span = right.time - left.time;
  if (span <= 1e-8) return right.value;
  const x = (u - left.time) / span;
  if (left.interpolation === 'hold') return left.value;
  if (left.interpolation === 'linear') return left.value + (right.value - left.value) * x;

  // Cubic Hermite. Tangents are value / normalized-time, so scale them by this segment's width.
  const secant = (right.value - left.value) / span;
  const m0 = finite(left.outTangent, secant) * span;
  const m1 = finite(right.inTangent, secant) * span;
  const x2 = x * x;
  const x3 = x2 * x;
  return (
    (2 * x3 - 3 * x2 + 1) * left.value +
    (x3 - 2 * x2 + x) * m0 +
    (-2 * x3 + 3 * x2) * right.value +
    (x3 - x2) * m1
  );
}

/** Compact, deterministic representation used by FeatherScript's timeline(curve: "…") argument. */
export function encodeTimelineCurve(keys: readonly TimelineCurveKey[] | undefined): string {
  const compact = (value: number | undefined) =>
    value === undefined ? '' : String(Number(finite(value, 0).toFixed(6)));
  return normalizeTimelineCurve(keys)
    .map((item) =>
      [compact(item.time), compact(item.value), item.interpolation, compact(item.inTangent), compact(item.outTangent)].join(','),
    )
    .join(';');
}

/** Parse either a named preset or the compact representation emitted by encodeTimelineCurve. */
export function decodeTimelineCurve(value: string | undefined): TimelineCurveKey[] | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  if (source === 'smooth' || source === 'linear' || source === 'easeIn' || source === 'easeOut') {
    return timelineCurvePreset(source);
  }
  const parsed: TimelineCurveKey[] = [];
  for (const [index, chunk] of source.split(';').entries()) {
    const [time, keyValue, interpolation, inTangent, outTangent] = chunk.split(',');
    const t = Number(time);
    const v = Number(keyValue);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    parsed.push({
      id: `curve-key-${index}`,
      time: t,
      value: v,
      interpolation:
        interpolation === 'hold' || interpolation === 'linear' || interpolation === 'cubic'
          ? interpolation
          : 'cubic',
      ...(inTangent === '' || inTangent === undefined ? {} : { inTangent: finite(inTangent, 0) }),
      ...(outTangent === '' || outTangent === undefined ? {} : { outTangent: finite(outTangent, 0) }),
    });
  }
  return parsed.length ? normalizeTimelineCurve(parsed) : undefined;
}

export interface TimelineTimeStep {
  time: number;
  direction: 1 | -1;
  finished: boolean;
}

/** Advance seconds along a one-shot, looping, or ping-pong Timeline without frame-size assumptions. */
export function advanceTimelineTime(
  time: number,
  delta: number,
  duration: number,
  loop: boolean,
  pingPong: boolean,
  direction: 1 | -1 = 1,
): TimelineTimeStep {
  const length = Math.max(0.0001, finite(duration, 1));
  const dt = Math.max(0, finite(delta, 0));
  if (dt === 0) return { time: Math.min(length, Math.max(0, time)), direction, finished: false };
  const raw = time + dt * direction;

  if (!loop) {
    if (direction > 0 && raw >= length) return { time: length, direction, finished: true };
    if (direction < 0 && raw <= 0) return { time: 0, direction, finished: true };
    return { time: Math.min(length, Math.max(0, raw)), direction, finished: false };
  }

  if (!pingPong) {
    const wrapped = ((raw % length) + length) % length;
    return { time: wrapped, direction, finished: false };
  }

  const period = length * 2;
  // `time` is folded into 0..length, so reconstruct its position on the full forward/backward
  // period before advancing. Using `time + delta * direction` directly would lose the backward
  // half after one frame and make a ping-pong Timeline jitter at its endpoint.
  const currentPhase = direction > 0 ? time : period - time;
  const phase = (((currentPhase + dt) % period) + period) % period;
  if (phase === 0) return { time: 0, direction: 1, finished: false };
  if (Math.abs(phase - length) < 1e-10) return { time: length, direction: -1, finished: false };
  return phase < length
    ? { time: phase, direction: 1, finished: false }
    : { time: period - phase, direction: -1, finished: false };
}
