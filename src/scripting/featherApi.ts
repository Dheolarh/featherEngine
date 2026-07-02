import type { GraphNodeKind, GraphValueType } from '../types';

export type FeatherApiKind = 'event' | 'call' | 'value' | 'statement' | 'variable';

export interface FeatherApiEntry {
  id: string;
  kind: FeatherApiKind;
  label: string;
  signature: string;
  insertText: string;
  description: string;
  detail?: string;
  keywords?: string[];
  nodeKind?: GraphNodeKind;
  valueType?: GraphValueType;
  aiSafe: boolean;
}

export interface FeatherCompletion extends FeatherApiEntry {
  replacementStart: number;
  replacementEnd: number;
  caretOffset: number;
  score: number;
}

export interface FeatherCompletionContext {
  replacementStart: number;
  replacementEnd: number;
  query: string;
  linePrefix: string;
  scope: 'event' | 'member' | 'line';
}

export interface FeatherDynamicSymbol {
  name: string;
  type: GraphValueType;
}

export interface FeatherCompletionOptions {
  blueprintVariables?: FeatherDynamicSymbol[];
  projectVariables?: FeatherDynamicSymbol[];
  limit?: number;
}

const event = (id: string, signature: string, insertText: string, description: string, keywords: string[] = []): FeatherApiEntry => ({
  id,
  kind: 'event',
  label: signature,
  signature,
  insertText,
  description,
  keywords,
  aiSafe: true,
});

const call = (
  id: string,
  signature: string,
  insertText: string,
  description: string,
  nodeKind: GraphNodeKind,
  keywords: string[] = [],
): FeatherApiEntry => ({
  id,
  kind: 'call',
  label: signature.slice(0, signature.indexOf('(') > 0 ? signature.indexOf('(') : signature.length),
  signature,
  insertText,
  description,
  nodeKind,
  keywords,
  aiSafe: true,
});

const value = (
  id: string,
  signature: string,
  insertText: string,
  description: string,
  nodeKind: GraphNodeKind,
  valueType: GraphValueType,
  keywords: string[] = [],
): FeatherApiEntry => ({
  id,
  kind: 'value',
  label: signature,
  signature,
  insertText,
  description,
  nodeKind,
  valueType,
  keywords,
  aiSafe: true,
});

const statement = (id: string, signature: string, insertText: string, description: string, keywords: string[] = []): FeatherApiEntry => ({
  id,
  kind: 'statement',
  label: signature,
  signature,
  insertText,
  description,
  keywords,
  aiSafe: true,
});

export const FEATHER_API_ENTRIES: FeatherApiEntry[] = [
  event('event.start', 'on start:', 'on start:\n    ', 'Runs once when the Blueprint starts.', ['begin', 'ready']),
  event('event.update', 'on update(dt):', 'on update(dt):\n    ', 'Runs every frame while Play is active.', ['tick', 'frame']),
  event('event.update.timer', 'on update every 1s:', 'on update every 1s:\n    ', 'Runs Update on an interval.', ['timer', 'interval']),
  event('event.key_down', 'on key_down("KeyW"):', 'on key_down("KeyW"):\n    ', 'Runs while a key is pressed.', ['input', 'keyboard']),
  event('event.key_up', 'on key_up("KeyW"):', 'on key_up("KeyW"):\n    ', 'Runs when a key is released.', ['input', 'keyboard']),
  event('event.custom', 'on event CustomEvent(payload):', 'on event CustomEvent(payload):\n    ', 'Runs when a custom event fires.', ['custom', 'message']),
  event('event.collision_enter', 'on collision_enter(other):', 'on collision_enter(other):\n    ', 'Runs when this object starts touching another collider.', ['physics', 'hit']),
  event('event.trigger_enter', 'on trigger_enter(other):', 'on trigger_enter(other):\n    ', 'Runs when this object starts overlapping a trigger.', ['overlap']),
  event('event.interact', 'on interact(player):', 'on interact(player):\n    ', 'Runs when the player interacts with this object.', ['use', 'pickup']),
  event('event.receive_damage', 'on receive_damage(amount):', 'on receive_damage(amount):\n    ', 'Runs when this object receives damage.', ['health', 'hit']),
  event('event.timer', 'on timer(1):', 'on timer(1):\n    ', 'Runs repeatedly every N seconds.', ['interval']),

  statement('statement.var.number', 'var health: number = 100', 'var health: number = 100', 'Declares a per-instance Blueprint variable.', ['variable']),
  statement('statement.if', 'if Game.Score > 10:', 'if Game.Score > 10:\n    ', 'Branches execution when the condition is true.', ['branch', 'condition']),
  statement('statement.if.else', 'if cond: ... else:', 'if self.armed:\n    pass\nelse:\n    pass', 'Branch with a false path (elif supported too).', ['branch', 'else', 'elif']),
  statement('statement.for.range', 'for index in range(5):', 'for index in range(5):\n    ', 'Repeats the body N times; index is the loop counter.', ['loop', 'repeat']),
  statement('statement.for.actors', 'for actor in find_actors(tag: "enemy"):', 'for actor in find_actors(tag: "enemy"):\n    ', 'Runs the body once per matching actor.', ['loop', 'actors', 'foreach']),
  statement('statement.if.cooldown', 'if cooldown(0.5):', 'if cooldown(0.5):\n    ', 'Gate: passes at most once per N seconds.', ['gate', 'rate']),
  statement('statement.if.do_once', 'if do_once():', 'if do_once():\n    ', 'Gate: passes only the first time per Play.', ['gate', 'once']),
  statement('statement.if.cast', 'if cast(other, "Blueprint"):', 'if cast(other, "Blueprint"):\n    ', 'Gate: passes when the target runs that blueprint; cast_actor references it after.', ['gate', 'cast', 'type']),

  call('call.print', 'print(message)', 'print("Ready")', 'Writes a message to the runtime console.', 'action.print', ['log', 'debug']),
  call('call.translate', 'self.translate(axis, amount)', 'self.translate(axis: "z", amount: 1)', 'Moves the owning object.', 'action.translate', ['move']),
  call('call.rotate', 'self.rotate(axis, amount)', 'self.rotate(axis: "y", amount: 90)', 'Rotates the owning object.', 'action.rotate', ['turn']),
  call('call.move', 'self.move(direction, speed)', 'self.move(Input.move(), speed: 4)', 'Character-style ground movement.', 'action.move', ['character']),
  call('call.drive', 'self.drive(input)', 'self.drive(Input.drive())', 'Vehicle-style drive input.', 'action.drive', ['vehicle', 'car']),
  call('call.jump', 'self.jump()', 'self.jump()', 'Makes the owning character jump.', 'action.jump', ['character']),
  call('call.move_to', 'self.move_to(target, speed)', 'self.move_to(Player.location, speed: 3)', 'Walks toward a position, pathfinding around walls (navmesh + steering).', 'action.moveTo', ['ai', 'chase', 'navigate']),
  call('call.wait', 'wait(seconds)', 'wait(0.5)', 'Pauses this execution chain briefly.', 'logic.delay', ['delay']),
  call('call.destroy', 'destroy(target)', 'destroy(self)', 'Destroys an object during Play.', 'action.destroyObject', ['remove']),
  call('call.fire_event', 'fire_event(name)', 'fire_event("CustomEvent")', 'Fires a custom event.', 'action.fireEvent', ['custom']),
  call('call.apply_damage', 'apply_damage(target, amount)', 'apply_damage(other, 10)', 'Deals damage to a target object.', 'action.applyDamage', ['combat']),
  call('call.apply_force', 'apply_force(target, vector, amount)', 'apply_force(self, vector: vec3(0, 1, 0), amount: 8)', 'Applies continuous force.', 'action.applyForce', ['physics']),
  call('call.apply_impulse', 'apply_impulse(target, vector, amount)', 'apply_impulse(self, vector: vec3(0, 1, 0), amount: 8)', 'Applies an instant impulse.', 'action.applyImpulse', ['physics']),
  call('call.set_var', 'set_var(target, key, value)', 'set_var(self, "health", 100)', 'Writes an object variable.', 'variable.setObject', ['variable']),
  call('call.apply_torque', 'apply_torque(target, vector, amount)', 'apply_torque(self, vector: vec3(0, 4, 0), amount: 4)', 'Instant spin kick on a dynamic body.', 'action.applyTorque', ['physics', 'spin']),
  call('call.set_position', 'set_position(target, vec3)', 'set_position(self, vec3(0, 2, 0))', 'Teleports an actor to a world position.', 'action.setPosition', ['transform', 'teleport']),
  call('call.set_rotation', 'set_rotation(target, vec3)', 'set_rotation(self, vec3(0, 90, 0))', 'Sets an actor rotation (Euler degrees).', 'action.setRotation', ['transform']),
  call('call.set_scale', 'set_scale(target, vec3)', 'set_scale(self, vec3(1, 1, 1))', 'Sets an actor scale.', 'action.setScale', ['transform']),
  call('call.look_at', 'look_at(target, point)', 'look_at(self, Player.location)', 'Yaws an actor to face a world position.', 'action.lookAt', ['aim', 'face']),
  call('call.set_velocity', 'set_velocity(target, vec3)', 'set_velocity(self, vec3(0, 0, 8))', "Hard-sets a dynamic body's velocity.", 'action.setVelocity', ['physics']),
  call('call.spawn_object', 'spawn_object(kind)', 'spawn_object("cube")', 'Spawns a primitive at the owner.', 'action.spawnObject', ['create']),
  call('call.spawn_prefab', 'spawn_prefab(prefabId, location)', 'spawn_prefab("prefab-id", location: self.position)', 'Instantiates a prefab during Play.', 'action.spawnPrefab', ['create', 'wave']),
  call('call.explode', 'explode(location, radius, damage)', 'explode(location: self.position, radius: 6, damage: 40)', 'Detonates a physics blast with damage.', 'action.explode', ['blast', 'grenade']),
  call('call.set_visible', 'set_visible(target, bool)', 'set_visible(self, false)', 'Shows/hides an actor mesh.', 'action.setVisible', ['hide']),
  call('call.set_active', 'set_active(target, bool)', 'set_active(self, false)', 'Fully enables/disables an actor.', 'action.setActive', ['disable']),
  call('call.face_player', 'self.face_player()', 'self.face_player()', 'Turns the owner toward the player.', 'action.facePlayer', ['aim']),
  call('call.ui_show', 'UI.show(documentId)', 'UI.show("doc-id")', 'Shows a game UI document.', 'ui.show', ['hud', 'menu']),
  call('call.ui_hide', 'UI.hide(documentId)', 'UI.hide("doc-id")', 'Hides a game UI document.', 'ui.hide', ['hud']),
  call('call.ui_set_text', 'UI.set_text(documentId, elementId, text)', 'UI.set_text("doc-id", "element-id", "Hello")', 'Sets a UI text element.', 'ui.setText', ['hud', 'label']),
  call('call.save_write', 'Save.write(slot)', 'Save.write("slot1")', 'Saves persistent variables to a slot.', 'save.write', ['persist']),
  call('call.save_load', 'Save.load(slot)', 'Save.load("slot1")', 'Loads a save slot.', 'save.load', ['persist']),
  call('call.audio_play', 'Audio.play(assetId)', 'Audio.play("asset-id")', 'Plays an audio asset.', 'action.playSound', ['sound']),
  call('call.scene_load', 'Scene.load(sceneId)', 'Scene.load("scene-id")', 'Switches the active scene during Play.', 'action.loadScene', ['level']),
  call('call.camera_shake', 'Camera.shake(amount)', 'Camera.shake(0.5)', 'Punches the follow camera with trauma.', 'action.cameraShake', ['juice']),
  call('call.screen_flash', 'Screen.flash(amount, color)', 'Screen.flash(0.7, color: "#ffffff")', 'Full-screen color blink.', 'action.screenFlash', ['juice']),
  call('call.animator_trigger', 'Animator.trigger(param)', 'Animator.trigger("Wave")', 'Fires an animator trigger parameter.', 'animator.setTrigger', ['animation']),

  value('value.input.move', 'Input.move()', 'Input.move()', 'WASD / arrow movement vector.', 'input.move', 'vector3', ['input']),
  value('value.input.drive', 'Input.drive()', 'Input.drive()', 'Vehicle throttle/steer/handbrake vector.', 'input.driveInput', 'vector3', ['input', 'vehicle']),
  value('value.grounded', 'self.is_grounded()', 'self.is_grounded()', 'True when the character is on the ground.', 'query.grounded', 'boolean', ['character']),
  value('value.speed', 'self.vehicle_speed()', 'self.vehicle_speed()', 'Current vehicle speed.', 'query.vehicleSpeed', 'number', ['vehicle']),
  value('value.vec3', 'vec3(x, y, z)', 'vec3(0, 0, 0)', 'Creates a 3D vector.', 'value.vector3', 'vector3', ['vector']),
  value('value.position', 'position(target)', 'position(self)', "An actor's world position.", 'action.getPosition', 'vector3', ['transform']),
  value('value.rotation', 'rotation(target)', 'rotation(self)', "An actor's rotation (Euler degrees).", 'action.getRotation', 'vector3', ['transform']),
  value('value.velocity', 'velocity(target)', 'velocity(self)', "An actor's current velocity.", 'query.velocity', 'vector3', ['physics']),
  value('value.player_location', 'Player.location', 'Player.location', "The player's world position.", 'ai.playerLocation', 'vector3', ['ai']),
  value('value.ai_distance', 'AI.distance_to_player()', 'AI.distance_to_player()', 'Distance from the owner to the player.', 'ai.distanceToPlayer', 'number', ['ai']),
  value('value.ai_direction', 'AI.direction_to_player()', 'AI.direction_to_player()', 'Unit direction from the owner to the player.', 'ai.directionToPlayer', 'vector3', ['ai']),
  value('value.ai_los', 'AI.has_line_of_sight()', 'AI.has_line_of_sight()', 'True when the owner can see the player.', 'ai.hasLineOfSight', 'boolean', ['ai']),
  value('value.get_var', 'get_var(target, key)', 'get_var(other, "health")', "Reads another actor's instance variable.", 'variable.getObject', 'number', ['variable']),
  value('value.find_actor', 'find_actor(tag/blueprint, mode)', 'find_actor(tag: "enemy", mode: "nearest")', 'Finds one matching actor reference.', 'query.findActorByTag', 'string', ['actor', 'search']),
  value('value.raycast', 'raycast(direction, distance).hit', 'raycast(direction: AI.direction_to_player(), distance: 20).hit', 'Casts a ray; read .hit/.actor/.point/.distance.', 'query.raycast', 'boolean', ['physics', 'sense']),
  value('value.overlap', 'overlap_sphere(location, radius).count', 'overlap_sphere(location: self.position, radius: 5).count', 'Who is in range; read .hit/.actor/.count.', 'query.overlapSphere', 'number', ['physics', 'aoe']),
  value('value.random', 'random(min, max)', 'random(0, 1)', 'Random number between min and max.', 'value.random', 'number', ['dice']),
  value('value.random_int', 'random_int(min, max)', 'random_int(1, 6)', 'Random whole number, max inclusive.', 'value.random', 'number', ['dice']),
  value('value.clamp', 'clamp(value, min, max)', 'clamp(Game.Score, 0, 100)', 'Clamps a number into a range.', 'math.clamp', 'number', ['math']),
  value('value.lerp', 'lerp(a, b, t)', 'lerp(0, 10, 0.5)', 'Linear interpolation.', 'math.lerp', 'number', ['math']),
  value('value.distance', 'distance(a, b)', 'distance(position(self), Player.location)', 'Distance between two positions.', 'math.distance', 'number', ['math', 'vector']),
  value('value.normalize', 'normalize(vector)', 'normalize(vec_sub(Player.location, position(self)))', 'Unit-length direction.', 'math.normalize', 'vector3', ['math', 'vector']),
  value('value.vec_add', 'vec_add(a, b)', 'vec_add(position(self), vec3(0, 2, 0))', 'Adds two vectors.', 'math.vectorAdd', 'vector3', ['math', 'vector']),
  value('value.vec_sub', 'vec_sub(a, b)', 'vec_sub(Player.location, position(self))', 'Subtracts vectors (direction b→a).', 'math.vectorSubtract', 'vector3', ['math', 'vector']),
  value('value.vec_scale', 'vec_scale(vector, scale)', 'vec_scale(AI.direction_to_player(), 5)', 'Multiplies a vector by a number.', 'math.vectorScale', 'vector3', ['math', 'vector']),
  value('value.append', 'append(a, b)', 'append("Score: ", Game.Score)', 'Joins two values as a string.', 'string.append', 'string', ['string', 'concat']),
  value('value.save_has', 'Save.has(slot)', 'Save.has("slot1")', 'True when the save slot holds data.', 'save.has', 'boolean', ['persist']),
];

export const FEATHER_AI_SAFE_API = FEATHER_API_ENTRIES.filter((entry) => entry.aiSafe);

export const FEATHER_SIDEBAR_API = FEATHER_API_ENTRIES.filter((entry) =>
  ['event.start', 'event.update', 'call.print', 'call.translate', 'call.jump', 'value.input.move', 'statement.if'].includes(entry.id),
);

export const featherCallEntryForCallee = (callee: string): FeatherApiEntry | undefined =>
  FEATHER_API_ENTRIES.find((entry) => entry.kind === 'call' && entry.insertText.startsWith(`${callee}(`));

const currentLineStart = (source: string, caret: number) => source.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;

const safeSymbolName = (value: string): string => {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return 'value';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
};

export const getFeatherCompletionContext = (source: string, caret: number): FeatherCompletionContext => {
  const lineStart = currentLineStart(source, caret);
  const linePrefix = source.slice(lineStart, caret);
  const indent = linePrefix.match(/^\s*/)?.[0] ?? '';
  const trimmedPrefix = linePrefix.slice(indent.length);

  if (/^on\s*/.test(trimmedPrefix)) {
    return {
      replacementStart: lineStart + indent.length,
      replacementEnd: caret,
      query: trimmedPrefix,
      linePrefix,
      scope: 'event',
    };
  }

  const token = linePrefix.match(/[A-Za-z_][A-Za-z0-9_.]*$/)?.[0] ?? '';
  return {
    replacementStart: caret - token.length,
    replacementEnd: caret,
    query: token,
    linePrefix,
    scope: token.includes('.') ? 'member' : 'line',
  };
};

const dynamicEntries = (options: FeatherCompletionOptions): FeatherApiEntry[] => [
  ...(options.projectVariables ?? []).map<FeatherApiEntry>((variable) => {
    const name = safeSymbolName(variable.name);
    return {
      id: `project.${name}`,
      kind: 'variable',
      label: `Game.${name}`,
      signature: `Game.${name}: ${variable.type}`,
      insertText: `Game.${name}`,
      description: 'Project variable shared across the game.',
      detail: variable.type,
      valueType: variable.type,
      aiSafe: true,
    };
  }),
  ...(options.blueprintVariables ?? []).map<FeatherApiEntry>((variable) => {
    const name = safeSymbolName(variable.name);
    return {
      id: `blueprint.${name}`,
      kind: 'variable',
      label: `self.${name}`,
      signature: `self.${name}: ${variable.type}`,
      insertText: `self.${name}`,
      description: 'Blueprint variable stored per object instance.',
      detail: variable.type,
      valueType: variable.type,
      aiSafe: true,
    };
  }),
];

const scoreEntry = (entry: FeatherApiEntry, query: string, scope: FeatherCompletionContext['scope']): number => {
  const q = query.toLowerCase();
  if (!q) return entry.kind === 'event' ? 6 : 4;
  const haystack = [entry.label, entry.signature, entry.insertText, ...(entry.keywords ?? [])].join(' ').toLowerCase();
  if (entry.insertText.toLowerCase().startsWith(q)) return 20;
  if (entry.label.toLowerCase().startsWith(q)) return 18;
  if (entry.signature.toLowerCase().startsWith(q)) return 16;
  if (haystack.includes(q)) return 8;
  if (scope === 'event' && entry.kind === 'event' && entry.signature.toLowerCase().includes(q.replace(/^on\s*/, ''))) return 12;
  return 0;
};

export const getFeatherCompletions = (
  source: string,
  caret: number,
  options: FeatherCompletionOptions = {},
): FeatherCompletion[] => {
  const context = getFeatherCompletionContext(source, caret);
  if (!context.query.trim()) return [];
  const entries = [...FEATHER_API_ENTRIES, ...dynamicEntries(options)].filter((entry) => {
    if (context.scope === 'event') return entry.kind === 'event';
    if (context.query.startsWith('self.')) return entry.insertText.startsWith('self.');
    if (context.query.startsWith('Game.')) return entry.insertText.startsWith('Game.');
    if (context.query.startsWith('Input.')) return entry.insertText.startsWith('Input.');
    return entry.kind !== 'event';
  });

  return entries
    .map((entry) => ({
      ...entry,
      replacementStart: context.replacementStart,
      replacementEnd: context.replacementEnd,
      caretOffset: entry.insertText.length,
      score: scoreEntry(entry, context.query, context.scope),
    }))
    .filter((completion) => completion.score > 0)
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature))
    .slice(0, options.limit ?? 7);
};
