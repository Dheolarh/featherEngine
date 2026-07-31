import type { SceneEnvironmentSettings } from '../types';

/** Fields the day-cycle ramp overwrites while the cycle is active. */
export type DayCycleVisual = Pick<
  SceneEnvironmentSettings,
  | 'sunAzimuth'
  | 'sunElevation'
  | 'sunColor'
  | 'sunIntensity'
  | 'skyTopColor'
  | 'skyHorizonColor'
  | 'skyGroundColor'
  | 'environmentIntensity'
  | 'fogColor'
>;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)] as const;
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bch = Math.round(lerp(ab, bb, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bch).toString(16).slice(1)}`;
}

type Key = { t: number; elev: number; inten: number; sun: string; top: string; hor: string; ground: string; amb: number; fog: string };

/** Coarse authored day ramp — sunrise → noon → sunset → night. */
const KEYS: Key[] = [
  { t: 0.0, elev: -12, inten: 0.08, sun: '#1a2240', top: '#050814', hor: '#0a1020', ground: '#05060a', amb: 0.35, fog: '#080c14' },
  { t: 0.22, elev: 2, inten: 0.55, sun: '#ffb070', top: '#3a5a88', hor: '#ff9a5c', ground: '#2a2030', amb: 0.7, fog: '#c89070' },
  { t: 0.35, elev: 28, inten: 1.15, sun: '#ffe1a3', top: '#5a9dff', hor: '#c8e4ff', ground: '#6a8a60', amb: 1.1, fog: '#b8d0e8' },
  { t: 0.5, elev: 58, inten: 1.55, sun: '#fffaf0', top: '#6eb6ff', hor: '#e8f4ff', ground: '#88b070', amb: 1.35, fog: '#d0e4f4' },
  { t: 0.68, elev: 22, inten: 1.05, sun: '#ffc080', top: '#4a78b8', hor: '#ffb070', ground: '#706048', amb: 0.95, fog: '#d0a888' },
  { t: 0.78, elev: 4, inten: 0.45, sun: '#ff7040', top: '#2a3868', hor: '#e87850', ground: '#281820', amb: 0.55, fog: '#a86050' },
  { t: 0.9, elev: -8, inten: 0.12, sun: '#304080', top: '#080c1c', hor: '#101828', ground: '#060810', amb: 0.4, fog: '#0a1018' },
  { t: 1.0, elev: -12, inten: 0.08, sun: '#1a2240', top: '#050814', hor: '#0a1020', ground: '#05060a', amb: 0.35, fog: '#080c14' },
];

function wrap01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

/** Sample sun/sky/fog colors for a normalized time of day in [0, 1). */
export function sampleDayCycle(timeOfDay: number): DayCycleVisual {
  const t = wrap01(timeOfDay);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const u = (t - a.t) / span;
  // Sun orbits once per day; elevation comes from the ramp so nights sit below the horizon.
  const azimuth = wrap01(t) * 360;
  return {
    sunAzimuth: azimuth,
    sunElevation: lerp(a.elev, b.elev, u),
    sunIntensity: lerp(a.inten, b.inten, u),
    sunColor: lerpHex(a.sun, b.sun, u),
    skyTopColor: lerpHex(a.top, b.top, u),
    skyHorizonColor: lerpHex(a.hor, b.hor, u),
    skyGroundColor: lerpHex(a.ground, b.ground, u),
    environmentIntensity: lerp(a.amb, b.amb, u),
    fogColor: lerpHex(a.fog, b.fog, u),
  };
}

/**
 * Merge day-cycle visuals onto an environment when the cycle is enabled.
 * `timeOverride` is used during Play (runtime clock); otherwise `environment.dayCycleTime`.
 */
export function withDayCycleVisuals(
  environment: SceneEnvironmentSettings,
  timeOverride?: number,
): SceneEnvironmentSettings {
  if (!environment.dayCycleEnabled) return environment;
  const t = timeOverride ?? environment.dayCycleTime ?? 0.35;
  return { ...environment, ...sampleDayCycle(t) };
}

export function wrapDayCycleTime(t: number): number {
  return wrap01(t);
}
