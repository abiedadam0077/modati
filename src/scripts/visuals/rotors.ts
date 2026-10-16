// Rotor visual entities: smooth client-side rotation of shafts, cogs and machine parts.
//
// The server only sends discrete property changes (model, orientation, speed, phase); the client
// animation computes angle = phase + time * rpm * 6 using query.time_stamp, so rotation costs no
// server ticks or network traffic while speed is constant. Rotors exist only near players
// (visual LOD); far away the block's own static geometry is shown instead.
import { Dimension, Entity, world } from '@minecraft/server';
import { DIRS, DIR_AXIS, Dir, V3, dimKey, parseDimKey, parsePosKey, posKey, Axis } from '../util/vec';
import { blockAt, dimension, entityValid, getStates, logError, players, setState } from '../core/env';
import { KINETIC_DEFS, RotorInfo, S_ALT, S_ROTOR, States, axisOf, facingOf, sideAxis, ID, S_PART } from '../kinetics/defs';
import { indexNear, speedOf } from '../kinetics/network';
import { settings } from '../core/settings';

export const ROTOR_ENTITY = 'craftoria:rotor';
const P = {
  model: 'craftoria:model', dir: 'craftoria:dir', roll: 'craftoria:roll', speed: 'craftoria:speed', speed2: 'craftoria:speed2',
  phase: 'craftoria:phase', p1: 'craftoria:p1', p2: 'craftoria:p2', p3: 'craftoria:p3', p4: 'craftoria:p4', rate: 'craftoria:rate',
} as const;
export const ROTOR_PROPS = P;

const SPAWN_R = 40;
const DESPAWN_R = 52;
const MAX_SPAWN_PER_PASS = 24;

const rotors = new Map<string, Entity>(); // dimKey -> entity
const extraHooks: ((key: string, e: Entity, st: States, typeId: string) => void)[] = [];

/** Machines can decorate rotor properties after (re)configuration. */
export function onRotorConfigured(fn: (key: string, e: Entity, st: States, typeId: string) => void): void {
  extraHooks.push(fn);
}

// ---------------------------------------------------------------------------
// Orientation math (must mirror tools/content/visuals.mjs animation)
const DIR_INDEX: Record<Dir, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
type M3 = number[]; // row-major 3x3
function rotM(axis: Axis, deg: number): M3 {
  const r = (deg * Math.PI) / 180, c = Math.round(Math.cos(r) * 1e9) / 1e9, s = Math.round(Math.sin(r) * 1e9) / 1e9;
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul(a: M3, b: M3): M3 {
  const o: M3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
function apply(m: M3, v: [number, number, number]): [number, number, number] {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
/** World-space RH orientation for each dir index (maps local +Y to the direction). */
export function orientMatrix(dir: Dir): M3 {
  switch (dir) {
    case 'up': return rotM('x', 0);
    case 'down': return rotM('x', 180);
    case 'north': return rotM('x', -90);
    case 'south': return rotM('x', 90);
    case 'east': return rotM('z', -90);
    case 'west': return rotM('z', 90);
  }
}
/** Sign (+1/-1) of the world image of a local axis along a world axis, or 0 if not parallel. */
export function localAxisSign(dir: Dir, roll: number, local: 'x' | 'y', world: Axis): number {
  const m = mul(orientMatrix(dir), rotM('y', roll));
  const v = apply(m, local === 'x' ? [1, 0, 0] : [0, 1, 0]);
  const c = world === 'x' ? v[0] : world === 'y' ? v[1] : v[2];
  return Math.abs(c) > 0.5 ? Math.sign(c) : 0;
}

function axisDir(a: Axis): Dir {
  return a === 'x' ? 'east' : a === 'y' ? 'up' : 'south';
}

function parity(n: number): number {
  return ((n % 2) + 2) % 2;
}

export interface RotorConfig {
  model: number;
  dir: Dir;
  roll: number;
  /** multiplier from node speed (about node axis) to the rotor's main spin property */
  speedSign: number;
  phase: number;
}

/** Compute rotor configuration for a block (pure apart from inputs). */
export function rotorConfig(typeId: string, st: States, pos: V3, info: RotorInfo): RotorConfig {
  const def = KINETIC_DEFS[typeId];
  const node = def.spec(st).nodes[0];
  let dir: Dir;
  let roll = 0;
  let local: 'x' | 'y' = 'y';
  switch (info.orient) {
    case 'axis': dir = axisDir(axisOf(st)); break;
    case 'up': dir = 'up'; break;
    default: dir = facingOf(st);
  }
  // side-axis machines spin a part about local X; choose roll so local X lies on the node axis
  if (typeId === ID('mechanical_saw') || typeId === ID('deployer') || typeId === ID('mechanical_piston')) {
    local = 'x';
    const want = sideAxis(facingOf(st), !!st[S_ALT]);
    roll = localAxisSign(dir, 0, 'x', want) !== 0 ? 0 : 90;
  }
  // gearbox stubs spin about their own outward normals (signs baked into the model bones)
  const speedSign = typeId === ID('gearbox') ? 1 : localAxisSign(dir, roll, local, node.axis) || 1;
  let phase = 0;
  if (info.phase) {
    const a = node.axis;
    const s = a === 'x' ? pos.y + pos.z : a === 'y' ? pos.x + pos.z : pos.x + pos.y;
    phase = info.phase === 'small' ? 22.5 * parity(s) : parity(s) === 0 ? 11.25 : 0;
  }
  return { model: info.model, dir, roll, speedSign, phase };
}

// ---------------------------------------------------------------------------

export function rotorAt(key: string): Entity | undefined {
  const e = rotors.get(key);
  if (e && entityValid(e)) return e;
  if (e) rotors.delete(key);
  return undefined;
}

function wantsRotor(typeId: string, st: States): RotorInfo | undefined {
  const def = KINETIC_DEFS[typeId];
  if (!def?.rotor) return undefined;
  if (typeId === ID('belt')) {
    const part = st[S_PART];
    if (part !== 'start' && part !== 'end') return undefined;
  }
  return def.rotor;
}

function setProp(e: Entity, id: string, v: number): void {
  try {
    if (e.getProperty(id) !== v) e.setProperty(id, v);
  } catch {
    /* property out of range or entity gone */
  }
}

/** Apply (or refresh) configuration and current speed on a rotor. */
export function configureRotor(key: string, e: Entity): boolean {
  const { dim, pos } = parseDimKey(key);
  const d = dimension(dim);
  const b = blockAt(d, pos);
  if (!b) return false;
  const st = getStates(b);
  const info = wantsRotor(b.typeId, st);
  if (!info) return false;
  const cfg = rotorConfig(b.typeId, st, pos, info);
  setProp(e, P.model, cfg.model);
  setProp(e, P.dir, DIR_INDEX[cfg.dir]);
  setProp(e, P.roll, cfg.roll);
  setProp(e, P.phase, cfg.phase);
  e.setDynamicProperty('cr:ss', cfg.speedSign);
  updateRotorSpeed(key, e, b.typeId);
  for (const h of extraHooks) {
    try {
      h(key, e, st, b.typeId);
    } catch (err) {
      logError('rotor hook', err);
    }
  }
  return true;
}

export function updateRotorSpeed(key: string, e?: Entity, typeId?: string): void {
  const ent = e ?? rotorAt(key);
  if (!ent) return;
  const { dim, pos } = parseDimKey(key);
  const ss = (ent.getDynamicProperty('cr:ss') as number | undefined) ?? 1;
  const tid = typeId ?? blockAt(dimension(dim), pos)?.typeId;
  if (tid === ID('clutch') || tid === ID('gearshift')) {
    setProp(ent, P.speed, round2(speedOf(dim, pos, 'a') * ss));
    setProp(ent, P.speed2, round2(speedOf(dim, pos, 'b') * ss));
    return;
  }
  setProp(ent, P.speed, round2(speedOf(dim, pos) * ss));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function spawnRotor(key: string): Entity | undefined {
  const existing = rotorAt(key);
  if (existing) return existing;
  const { dim, pos } = parseDimKey(key);
  const d = dimension(dim);
  const b = blockAt(d, pos);
  if (!b || !wantsRotor(b.typeId, getStates(b))) return undefined;
  try {
    const e = d.spawnEntity(ROTOR_ENTITY, { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 }, { initialRotation: 0 });
    e.setDynamicProperty('cr:k', key);
    rotors.set(key, e);
    configureRotor(key, e);
    setState(b, S_ROTOR, true);
    return e;
  } catch (err) {
    logError('spawnRotor', err);
    return undefined;
  }
}

export function removeRotor(key: string, restoreBlock = true): void {
  const e = rotors.get(key);
  rotors.delete(key);
  if (e) {
    try {
      if (e.isValid) e.remove();
    } catch {
      /* ignore */
    }
  }
  if (restoreBlock) {
    const { dim, pos } = parseDimKey(key);
    const b = blockAt(dimension(dim), pos);
    if (b) setState(b, S_ROTOR, false);
  }
}

/** Adopt a rotor loaded from disk or remove it when orphaned/duplicate. */
export function adoptRotor(e: Entity): void {
  try {
    if (e.typeId !== ROTOR_ENTITY) return;
    const loc = e.location;
    const key = dimKey(e.dimension.id, { x: Math.floor(loc.x), y: Math.floor(loc.y + 0.01), z: Math.floor(loc.z) });
    const cur = rotorAt(key);
    if (cur && cur.id !== e.id) {
      e.remove();
      return;
    }
    const { pos } = parseDimKey(key);
    const b = blockAt(e.dimension, pos);
    if (!b || !wantsRotor(b.typeId, getStates(b)) || !settings.rotors) {
      e.remove();
      if (b) setState(b, S_ROTOR, false);
      return;
    }
    rotors.set(key, e);
    configureRotor(key, e);
    setState(b, S_ROTOR, true);
  } catch (err) {
    logError('adoptRotor', err);
  }
}

/** Periodic LOD pass: spawn rotors near players, remove far ones. */
export function tickRotorLOD(): void {
  if (!settings.rotors) {
    for (const k of [...rotors.keys()]) removeRotor(k);
    return;
  }
  const ps = players();
  const want = new Set<string>();
  const near: { dim: string; x: number; y: number; z: number }[] = [];
  for (const p of ps) {
    try {
      const loc = p.location;
      const dim = p.dimension.id;
      near.push({ dim, x: loc.x, y: loc.y, z: loc.z });
      for (const pk of indexNear(dim, { x: Math.floor(loc.x), y: 0, z: Math.floor(loc.z) }, SPAWN_R)) {
        const bp = parsePosKey(pk);
        const dx = bp.x + 0.5 - loc.x, dy = bp.y + 0.5 - loc.y, dz = bp.z + 0.5 - loc.z;
        if (dx * dx + dy * dy + dz * dz <= SPAWN_R * SPAWN_R) want.add(`${dim}|${pk}`);
      }
    } catch {
      /* player not ready */
    }
  }
  let spawned = 0;
  for (const k of want) {
    if (rotorAt(k)) continue;
    if (spawned >= MAX_SPAWN_PER_PASS) break;
    if (spawnRotor(k)) spawned++;
  }
  for (const [k, e] of rotors) {
    if (want.has(k)) continue;
    if (!entityValid(e)) {
      rotors.delete(k);
      continue;
    }
    const { dim, pos } = parseDimKey(k);
    let close = false;
    for (const n of near) {
      if (n.dim !== dim) continue;
      const dx = pos.x + 0.5 - n.x, dy = pos.y - n.y, dz = pos.z + 0.5 - n.z;
      if (dx * dx + dy * dy + dz * dz <= DESPAWN_R * DESPAWN_R) {
        close = true;
        break;
      }
    }
    if (!close) removeRotor(k);
  }
}

/** Validate tracked rotors (block still matches) – slow periodic task. */
export function validateRotors(): void {
  for (const [k, e] of [...rotors]) {
    if (!entityValid(e)) {
      rotors.delete(k);
      continue;
    }
    const { dim, pos } = parseDimKey(k);
    const b = blockAt(dimension(dim), pos);
    if (!b) continue; // unloaded: leave it, it unloads with the chunk
    if (!wantsRotor(b.typeId, getStates(b))) removeRotor(k, false);
  }
}

export function scanExistingRotors(): void {
  for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
    let d: Dimension;
    try {
      d = world.getDimension(id);
      for (const e of d.getEntities({ type: ROTOR_ENTITY })) adoptRotor(e);
    } catch {
      /* dimension not loaded */
    }
  }
}

export function rotorCount(): number {
  return rotors.size;
}

export function allRotorKeys(): string[] {
  return [...rotors.keys()];
}

export { DIRS, DIR_AXIS, posKey };
