import type { GraphValueType } from '../types';

/**
 * One-click BEHAVIORS (GDevelop-style "ready-made behaviors", Unreal-style starter components):
 * attachable gameplay logic chunks. Each behavior is a FeatherScript source compiled through the
 * regular blueprint pipeline, so attaching one yields a REAL blueprint the user can open, read as
 * text or nodes, and edit — behaviors are a starting point, not a black box.
 *
 * Rules for presets:
 * - The script MUST compile warning-free on the current FeatherScript surface (tests enforce this).
 * - Per-instance state goes in `var` declarations so every object gets its own copy.
 * - Project variables a script needs are declared in `ensureProjectVariables` (created if missing).
 * - `physics` describes the collider the behavior needs on its object ('trigger' = overlap sensor,
 *   'fixed' = solid static collider); attach applies it non-destructively.
 */
export interface BehaviorPreset {
  id: string;
  name: string;
  description: string;
  /** Emoji glyph for menus. */
  icon: string;
  script: string;
  ensureProjectVariables?: Array<{ name: string; type: GraphValueType; defaultValue?: number | string | boolean }>;
  physics?: 'trigger' | 'fixed';
}

export const BEHAVIOR_PRESETS: BehaviorPreset[] = [
  {
    id: 'rotating-prop',
    name: 'Rotating Prop',
    description: 'Spins in place — pickups, fans, radar dishes. Edit spin_speed per object.',
    icon: '🔄',
    script: [
      'blueprint Behavior_Rotating_Prop',
      '',
      'var spin_speed: number = 90',
      '',
      'on update(dt):',
      '    self.rotate(axis: "y", amount: self.spin_speed)',
    ].join('\n'),
  },
  {
    id: 'bounce-pad',
    name: 'Bounce Pad',
    description: 'Launches whatever touches it into the air. Needs to be a solid collider.',
    icon: '🦘',
    physics: 'fixed',
    script: [
      'blueprint Behavior_Bounce_Pad',
      '',
      'var launch_power: number = 12',
      '',
      'on collision_enter(other):',
      '    apply_force(other, vector: vec_scale(vec3(0, 1, 0), self.launch_power))',
    ].join('\n'),
  },
  {
    id: 'collectible',
    name: 'Collectible',
    description: 'Touch to collect: adds to the Score project variable, flashes, and disappears.',
    icon: '💰',
    physics: 'trigger',
    ensureProjectVariables: [{ name: 'Score', type: 'number', defaultValue: 0 }],
    script: [
      'blueprint Behavior_Collectible',
      '',
      'var value: number = 10',
      '',
      'on trigger_enter(other):',
      '    Game.Score = (Game.Score + self.value)',
      '    Screen.flash(0.25, color: "#ffd75e")',
      '    destroy(self)',
    ].join('\n'),
  },
  {
    id: 'health-and-death',
    name: 'Health & Death',
    description: 'Gives the object hit points; it dies (with a burst) when health reaches zero.',
    icon: '❤️',
    script: [
      'blueprint Behavior_Health',
      '',
      'var health: number = 100',
      '',
      'on receive_damage(amount):',
      '    self.health = (self.health - amount)',
      '    if (self.health <= 0):',
      '        explode(location: self.position, radius: 2, damage: 0)',
      '        destroy(self)',
    ].join('\n'),
  },
  {
    id: 'chase-player',
    name: 'Chase Player',
    description: 'Walks toward the player when in range, pathfinding around walls (navmesh).',
    icon: '👣',
    script: [
      'blueprint Behavior_Chase_Player',
      '',
      'var speed: number = 3',
      'var aggro_range: number = 14',
      '',
      'on update(dt):',
      '    if (AI.distance_to_player() < self.aggro_range):',
      '        self.move_to(Player.location, speed: self.speed)',
    ].join('\n'),
  },
  {
    id: 'damage-zone',
    name: 'Damage Zone',
    description: 'Hurts whatever stands inside it — lava, spikes, toxic pools. Overlap sensor.',
    icon: '☠️',
    physics: 'trigger',
    script: [
      'blueprint Behavior_Damage_Zone',
      '',
      'var damage: number = 15',
      '',
      'on trigger_enter(other):',
      '    apply_damage(other, self.damage)',
      '    Screen.flash(0.3, color: "#ff3b30")',
    ].join('\n'),
  },
  {
    id: 'door-on-interact',
    name: 'Door (Interact)',
    description: 'Press Interact to slide it open; interact again to close. Edit the slide vector.',
    icon: '🚪',
    physics: 'fixed',
    script: [
      'blueprint Behavior_Door',
      '',
      'var open: boolean = false',
      'var slide: vector3 = vec3(0, 3, 0)',
      '',
      'on interact(player):',
      '    if self.open:',
      '        self.open = false',
      '        set_position(self, vec_sub(position(self), self.slide))',
      '    else:',
      '        self.open = true',
      '        set_position(self, vec_add(position(self), self.slide))',
    ].join('\n'),
  },
];

export const findBehaviorPreset = (id: string): BehaviorPreset | undefined =>
  BEHAVIOR_PRESETS.find((preset) => preset.id === id);
