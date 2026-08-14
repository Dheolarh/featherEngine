import type { CharacterControllerComponent } from '../types';

/** True while the character's active dodge roll is inside its configured invulnerability window. */
export function isRollInvulnerable(
  rollRemaining: number,
  character: Pick<CharacterControllerComponent, 'rollDuration' | 'rollIFrameStart' | 'rollIFrameEnd'>,
): boolean {
  if (rollRemaining <= 0) return false;
  const start = character.rollIFrameStart ?? 0;
  const end = character.rollIFrameEnd ?? 0;
  if (end <= start) return false;
  const duration = Math.max(0.05, character.rollDuration ?? 0.7);
  const elapsed = Math.max(0, duration - rollRemaining);
  return elapsed >= start && elapsed <= end;
}

/** Per-hit melee damage for a combo index (0-based), scaling slightly toward the finisher. */
export function meleeComboDamage(base: number, comboIndex: number): number {
  return Math.max(1, Math.round(base * (1 + 0.12 * Math.max(0, comboIndex))));
}
