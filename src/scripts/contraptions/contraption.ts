// Moving structures (contraptions): assembly from glued blocks, smooth rendering with block-display
// entities, rotation (mechanical / windmill bearings), vertical (rope pulley / elevator) and linear
// (mechanical piston) motion, disassembly back into real blocks, persistence across reloads.
import { Block, BlockPermutation, Dimension, Entity, Player, system, world } from '@minecraft/server';
import { AXIS_DIRS, Axis, DIRS, DIR_AXIS, DIR_SIGN, DIR_VEC, Dir, OPPOSITE, V3, add, dimKey, offset, posKey } from '../util/vec';
import { blockAt, dimension, entityValid, getStates, logError, msg, players, setStates, now } from '../core/env';
import { BlockStore, globalStore } from '../core/store';
import { settings } from '../core/settings';
import { ID, facingOf } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { setWindmillSpeed } from '../kinetics/generators';
import { getContainer } from '../util/items';
import { CONTRAPTION_TABLE } from '../generated/contraption_table';
import { registerMachine } from '../machines/registry';
import { dropItem } from '../logistics/transport';
import { sound } from '../machines/common';
import { orientMatrix, rotorAt, ROTOR_PROPS } from '../visuals/rotors';

export const BLOCK_DISPLAY = 'craftoria:block_display';
const DIR_INDEX: Record<Dir, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

// ------------------------------------------------------------------ glue regions
export interface GlueBox {
  dim: string;
  min: V3;
  max: V3;
}
let glue: GlueBox[] = [];
const gluePending = new Map<string, { dim: string; pos: V3 }>();
export function loadGlue(): void {
  glue = globalStore.get<GlueBox[]>('glue') ?? [];
}
function saveGlue(): void {
  globalStore.set('glue', glue);
}
export function inGlue(dim: string, p: V3): GlueBox[] {
  return glue.filter((g) => g.dim === dim && p.x >= g.min.x && p.x <= g.max.x && p.y >= g.min.y && p.y <= g.max.y && p.z >= g.min.z && p.z <= g.max.z);
}
export function useGlue(p: Player, b: Block): void {
  const dimId = b.dimension.id;
  const pos = { ...b.location };
  if (p.isSneaking) {
    const before = glue.length;
    glue = glue.filter((g) => !(g.dim === dimId && pos.x >= g.min.x && pos.x <= g.max.x && pos.y >= g.min.y && pos.y <= g.max.y && pos.z >= g.min.z && pos.z <= g.max.z));
    saveGlue();
    msg(p, before !== glue.length ? '§eGlue removed from this area.' : '§7No glue here.');
    return;
  }
  const first = gluePending.get(p.id);
  if (!first || first.dim !== dimId) {
    gluePending.set(p.id, { dim: dimId, pos });
    msg(p, '§aSuper Glue: first corner set. Use on the opposite corner.');
    sound(b.dimension, 'craftoria.glue', b.center(), 0.5);
    return;
  }
  gluePending.delete(p.id);
  const min = { x: Math.min(first.pos.x, pos.x), y: Math.min(first.pos.y, pos.y), z: Math.min(first.pos.z, pos.z) };
  const max = { x: Math.max(first.pos.x, pos.x), y: Math.max(first.pos.y, pos.y), z: Math.max(first.pos.z, pos.z) };
  const vol = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
  if (vol > 4096) {
    msg(p, '§cGlue area too large (max 4096 blocks).');
    return;
  }
  glue.push({ dim: dimId, min, max });
  saveGlue();
  msg(p, `§aGlued ${max.x - min.x + 1}x${max.y - min.y + 1}x${max.z - min.z + 1} area. Blocks inside move together.`);
  sound(b.dimension, 'craftoria.glue', b.center(), 0.6);
}
/** Show glue outlines to players holding super glue. */
export function showGlue(): void {
  if (settings.particles <= 0) return;
  for (const p of players()) {
    try {
      const it = p.getComponent('minecraft:inventory')?.container?.getItem(p.selectedSlotIndex);
      if (!it || it.typeId !== ID('super_glue')) continue;
      const l = p.location;
      for (const g of glue) {
        if (g.dim !== p.dimension.id) continue;
        if (Math.abs(g.min.x - l.x) > 32 || Math.abs(g.min.z - l.z) > 32) continue;
        const pts: V3[] = [];
        for (const x of [g.min.x, g.max.x + 1]) for (const y of [g.min.y, g.max.y + 1]) for (const z of [g.min.z, g.max.z + 1]) pts.push({ x, y, z });
        for (const pt of pts) p.dimension.spawnParticle('minecraft:villager_happy', pt);
      }
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ contraption data
export interface CBlock {
  o: V3; // offset from the anchor (blocks)
  id: string;
  st: Record<string, string | number | boolean>;
}
export interface Contraption {
  id: number;
  kind: 'bearing' | 'windmill' | 'pulley' | 'piston' | 'train';
  dim: string;
  owner: V3; // machine position
  anchor: V3; // world position of offset (0,0,0) at rest
  blocks: CBlock[];
  dir: Dir; // rotation axis direction (bearings) or motion direction
  angle: number; // degrees (rotating)
  phase: number;
  move: number; // blocks travelled along dir (translating)
  target?: number; // target angle / move
  ents: string[];
  sails?: number;
  lastRpm?: number;
  sync?: number;
}
const contraptions = new Map<number, Contraption>();
const byOwner = new Map<string, number>();
let nextId = 1;
let dirty = false;

export function contraptionAt(dim: string, owner: V3): Contraption | undefined {
  const id = byOwner.get(dimKey(dim, owner));
  return id === undefined ? undefined : contraptions.get(id);
}
export function contraptionCount(): number {
  return contraptions.size;
}

function persist(): void {
  dirty = true;
}
export function saveContraptions(): void {
  if (!dirty) return;
  dirty = false;
  globalStore.set('contraptions', [...contraptions.values()].map((c) => ({ ...c, ents: [] })));
}
export function loadContraptions(): void {
  const list = globalStore.get<Contraption[]>('contraptions') ?? [];
  for (const c of list) {
    c.ents = [];
    contraptions.set(c.id, c);
    byOwner.set(dimKey(c.dim, c.owner), c.id);
    nextId = Math.max(nextId, c.id + 1);
    if (c.kind === 'pulley' || c.kind === 'piston') {
      // interrupted linear motion: settle at the nearest whole block on next tick
      c.target = Math.round(c.move);
    }
    if (c.kind === 'windmill') {
      const cfg = bearingCfg.get(dimKey(c.dim, c.owner));
      setWindmillSpeed(c.dim, c.owner, windmillRpm(c.sails ?? 0) * (cfg?.cw ? -1 : 1));
    }
  }
  // remove stale display entities; they are respawned from data
  system.runTimeout(() => {
    for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
      try {
        for (const e of world.getDimension(id).getEntities({ type: BLOCK_DISPLAY })) e.remove();
      } catch {
        /* ignore */
      }
    }
    for (const c of contraptions.values()) spawnDisplays(c);
  }, 40);
}

// ------------------------------------------------------------------ assembly
const NEVER_MOVE = new Set(['minecraft:bedrock', 'minecraft:barrier', 'minecraft:obsidian', 'minecraft:end_portal_frame', 'minecraft:reinforced_deepslate', 'minecraft:command_block',
  'minecraft:structure_block', 'minecraft:jigsaw', 'minecraft:portal', 'minecraft:end_portal', 'minecraft:end_gateway', 'minecraft:moving_block']);
const ALWAYS_STICK = new Set([ID('sail'), ID('sail_frame')]);
const MACHINE_DATA_BLOCKS = new Set([ID('depot'), ID('basin'), ID('belt'), ID('fluid_tank'), ID('spout'), ID('millstone'), ID('deployer'), ID('mechanical_arm'), ID('chute')]);

function movable(b: Block): boolean {
  if (b.isAir || b.isLiquid) return false;
  if (NEVER_MOVE.has(b.typeId)) return false;
  if (getContainer(b)) return false; // containers stay (their inventories cannot be carried safely)
  if (MACHINE_DATA_BLOCKS.has(b.typeId) && !(b.typeId in CONTRAPTION_TABLE.custom)) return false;
  if (b.typeId.startsWith('craftoria:') && (b.typeId.includes('bearing') || b.typeId.includes('pulley') || b.typeId.includes('piston') || b.typeId === ID('belt'))) return false;
  return true;
}

function fragile(id: string): boolean {
  return /torch|lever|button|rail|carpet|flower|sapling|sign|banner|redstone_wire|repeater|comparator|ladder|vine|lantern|candle|pressure_plate|tripwire|_door|trapdoor|bed$|kelp|seagrass|grass$|fern|bush|mushroom$/.test(id);
}

/** Flood-fill the structure from `start` (sails stick, other blocks need super glue). */
export function collectStructure(dim: Dimension, start: V3, exclude: V3): V3[] {
  const out: V3[] = [];
  const seen = new Set<string>([posKey(exclude)]);
  const q: V3[] = [start];
  const max = settings.maxContraptionBlocks;
  while (q.length) {
    const p = q.shift()!;
    const k = posKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockAt(dim, p);
    if (!b || !movable(b)) continue;
    out.push(p);
    if (out.length >= max) break;
    const gp = inGlue(dim.id, p);
    for (const d of DIRS) {
      const n = offset(p, d);
      if (seen.has(posKey(n))) continue;
      const nb = blockAt(dim, n);
      if (!nb || nb.isAir) continue;
      const glued = gp.some((g) => n.x >= g.min.x && n.x <= g.max.x && n.y >= g.min.y && n.y <= g.max.y && n.z >= g.min.z && n.z <= g.max.z);
      if (glued || ALWAYS_STICK.has(nb.typeId) || ALWAYS_STICK.has(b.typeId) && ALWAYS_STICK.has(nb.typeId)) q.push(n);
    }
  }
  return out;
}

function assemble(kind: Contraption['kind'], dim: Dimension, owner: V3, anchor: V3, d: Dir): Contraption | undefined {
  const cells = collectStructure(dim, anchor, owner);
  if (!cells.length) return undefined;
  const c: Contraption = { id: nextId++, kind, dim: dim.id, owner: { ...owner }, anchor: { ...anchor }, blocks: [], dir: d, angle: 0, phase: 0, move: 0, ents: [] };
  for (const p of cells) {
    const b = blockAt(dim, p)!;
    c.blocks.push({ o: { x: p.x - anchor.x, y: p.y - anchor.y, z: p.z - anchor.z }, id: b.typeId, st: getStates(b) });
  }
  // remove fragile blocks first so nothing pops off and duplicates
  const order = [...cells].sort((a, b) => Number(fragile(blockAt(dim, b)?.typeId ?? '')) - Number(fragile(blockAt(dim, a)?.typeId ?? '')));
  for (const p of order) {
    try {
      dim.setBlockType(p, 'minecraft:air');
    } catch (e) {
      logError('assemble remove', e);
    }
  }
  c.sails = c.blocks.filter((x) => ALWAYS_STICK.has(x.id)).length;
  contraptions.set(c.id, c);
  byOwner.set(dimKey(dim.id, owner), c.id);
  spawnDisplays(c);
  persist();
  sound(dim, 'craftoria.contraption_start', { x: owner.x + 0.5, y: owner.y + 0.5, z: owner.z + 0.5 }, 0.6);
  return c;
}

// ------------------------------------------------------------------ rendering
function transpose(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function mulv(m: number[], v: V3): V3 {
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
}
function dirOfVec(v: V3): Dir {
  const r = (n: number) => Math.round(n);
  const x = r(v.x), y = r(v.y), z = r(v.z);
  if (y === 1) return 'up';
  if (y === -1) return 'down';
  if (z === -1) return 'north';
  if (z === 1) return 'south';
  if (x === -1) return 'west';
  return 'east';
}

function rotatingSpeed(c: Contraption): number {
  if (c.kind !== 'bearing' && c.kind !== 'windmill') return 0;
  return speedOf(c.dim, c.owner) * DIR_SIGN[c.dir];
}

/** World position of the rotation pivot / translation origin for display entities. */
function pivotOf(c: Contraption): V3 {
  const v = DIR_VEC[c.dir];
  const m = c.kind === 'bearing' || c.kind === 'windmill' ? 0 : c.move;
  return { x: c.anchor.x + 0.5 + v.x * m, y: c.anchor.y + 0.5 + v.y * m, z: c.anchor.z + 0.5 + v.z * m };
}

function spawnDisplays(c: Contraption): void {
  const dim = dimension(c.dim);
  despawnDisplays(c);
  const rot = c.kind === 'bearing' || c.kind === 'windmill';
  const orientDir: Dir = rot ? c.dir : 'up';
  const Mt = transpose(orientMatrix(orientDir));
  const pivot = pivotOf(c);
  const spd = rotatingSpeed(c);
  for (const cb of c.blocks) {
    const l = mulv(Mt, cb.o);
    const P = { x: l.x * 16, y: l.y * 16 - 8, z: l.z * 16 };
    try {
      const e = dim.spawnEntity(BLOCK_DISPLAY, pivot, { initialRotation: 0 });
      e.setDynamicProperty('cr:c', c.id);
      const set = (k: string, v: number) => e.setProperty(`craftoria:${k}`, v);
      set('dir', DIR_INDEX[orientDir]);
      set('ox', P.x);
      set('oy', P.y);
      set('oz', -P.z);
      set('speed', rot ? spd : 0);
      set('phase', rot ? c.angle : 0);
      const facing = cb.st['craftoria:facing'] as Dir | undefined;
      if (facing && facing in DIR_VEC) set('bdir', DIR_INDEX[dirOfVec(mulv(Mt, DIR_VEC[facing]))]);
      const custom = CONTRAPTION_TABLE.custom[cb.id];
      const own = CONTRAPTION_TABLE.own[cb.id];
      const van = CONTRAPTION_TABLE.vanilla[cb.id];
      if (custom !== undefined) set('geo', custom);
      else if (own !== undefined) {
        set('geo', 0);
        set('tex', own);
        set('tex2', own);
      } else if (van) {
        set('geo', 0);
        set('tex', van[0]);
        set('tex2', van[1]);
      } else {
        set('geo', 1);
        try {
          e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${cb.id} 1`);
        } catch {
          /* block without item form */
        }
      }
      c.ents.push(e.id);
    } catch (err) {
      logError('spawn display', err);
      break;
    }
  }
}

function despawnDisplays(c: Contraption): void {
  for (const id of c.ents) {
    try {
      const e = world.getEntity(id);
      if (e?.isValid) e.remove();
    } catch {
      /* ignore */
    }
  }
  c.ents = [];
}

function forEachDisplay(c: Contraption, fn: (e: Entity) => void): void {
  for (const id of c.ents) {
    try {
      const e = world.getEntity(id);
      if (e && entityValid(e)) fn(e);
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ disassembly
const STATE_ROT_KEYS = ['craftoria:facing', 'minecraft:facing_direction', 'minecraft:cardinal_direction', 'facing_direction', 'direction'];

function rotateDir(d: Dir, axis: Axis, quarter: number): Dir {
  let v = DIR_VEC[d];
  for (let i = 0; i < ((quarter % 4) + 4) % 4; i++) v = rot90(v, axis);
  return dirOfVec(v);
}
function rot90(v: V3, axis: Axis): V3 {
  // RH +90 about axis
  if (axis === 'x') return { x: v.x, y: -v.z, z: v.y };
  if (axis === 'y') return { x: v.z, y: v.y, z: -v.x };
  return { x: -v.y, y: v.x, z: v.z };
}
function rotateStates(st: Record<string, string | number | boolean>, axis: Axis, quarter: number): Record<string, string | number | boolean> {
  if (!quarter) return st;
  const out = { ...st };
  for (const k of STATE_ROT_KEYS) {
    const v = out[k];
    if (typeof v === 'string' && v in DIR_VEC) out[k] = rotateDir(v as Dir, axis, quarter);
  }
  for (const k of ['craftoria:axis', 'pillar_axis']) {
    const v = out[k];
    if (v === 'x' || v === 'y' || v === 'z') {
      const d = rotateDir(AXIS_DIRS[v as Axis][1], axis, quarter);
      out[k] = DIR_AXIS[d];
    }
  }
  return out;
}

function disassemble(c: Contraption): void {
  const dim = dimension(c.dim);
  const rot = c.kind === 'bearing' || c.kind === 'windmill';
  const quarter = rot ? Math.round(c.angle / 90) : 0;
  const axis = DIR_AXIS[c.dir];
  const sgn = DIR_SIGN[c.dir];
  const shift = rot ? { x: 0, y: 0, z: 0 } : { x: DIR_VEC[c.dir].x * Math.round(c.move), y: DIR_VEC[c.dir].y * Math.round(c.move), z: DIR_VEC[c.dir].z * Math.round(c.move) };
  const placed: { p: V3; cb: CBlock; st: Record<string, string | number | boolean> }[] = [];
  for (const cb of c.blocks) {
    let o = cb.o;
    // rotation by quarter turns about the bearing direction (RH about +dir)
    for (let i = 0; i < ((quarter * sgn) % 4 + 4) % 4; i++) o = rot90(o, axis);
    const p = add(add(c.anchor, o), shift);
    placed.push({ p, cb, st: rotateStates(cb.st, axis, quarter * sgn) });
  }
  // place solid blocks first, fragile last
  placed.sort((a, b) => Number(fragile(a.cb.id)) - Number(fragile(b.cb.id)));
  for (const { p, cb, st } of placed) {
    const b = blockAt(dim, p);
    if (!b) continue;
    if (!(b.isAir || b.isLiquid || b.typeId === 'minecraft:air')) {
      dropItem(dim, { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, { id: cb.id, n: 1 });
      continue;
    }
    try {
      let perm = BlockPermutation.resolve(cb.id);
      for (const [k, v] of Object.entries(st)) {
        try {
          perm = perm.withState(k as never, v as never);
        } catch {
          /* state not applicable */
        }
      }
      b.setPermutation(perm);
    } catch {
      dropItem(dim, { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, { id: cb.id, n: 1 });
    }
  }
  despawnDisplays(c);
  contraptions.delete(c.id);
  byOwner.delete(dimKey(c.dim, c.owner));
  if (c.kind === 'windmill') setWindmillSpeed(c.dim, c.owner, 0);
  persist();
  sound(dim, 'craftoria.contraption_stop', { x: c.owner.x + 0.5, y: c.owner.y + 0.5, z: c.owner.z + 0.5 }, 0.6);
}

/** Destroy without placing (machine broken): drop everything as items. */
function shatter(c: Contraption): void {
  const dim = dimension(c.dim);
  const p = pivotOf(c);
  for (const cb of c.blocks) dropItem(dim, p, { id: cb.id, n: 1 });
  despawnDisplays(c);
  contraptions.delete(c.id);
  byOwner.delete(dimKey(c.dim, c.owner));
  if (c.kind === 'windmill') setWindmillSpeed(c.dim, c.owner, 0);
  persist();
}

// ------------------------------------------------------------------ bearings
interface BearingCfg {
  limit: number; // 0 = free rotation, 90 / 180 = door / drawbridge mode
  cw?: boolean; // windmill direction
}
const bearingCfg = new BlockStore<BearingCfg>('brg');

export function windmillRpm(sails: number): number {
  if (sails < 8) return 0;
  return Math.max(1, Math.min(16, Math.floor(sails / 8)));
}

function bearingInteract(b: Block, p: Player): boolean {
  const dim = b.dimension;
  const f = facingOf(getStates(b));
  const key = dimKey(dim.id, b.location);
  const isWindmill = b.typeId === ID('windmill_bearing');
  const c = contraptionAt(dim.id, b.location);
  if (p.isSneaking && !isWindmill) {
    const cfg = bearingCfg.get(key) ?? { limit: 0 };
    cfg.limit = cfg.limit === 0 ? 90 : cfg.limit === 90 ? 180 : 0;
    bearingCfg.set(key, cfg);
    msg(p, cfg.limit ? `§aBearing door mode: rotates ${cfg.limit}° when powered one way and back when reversed (use a gearshift + lever).` : '§aBearing free-rotation mode.');
    return true;
  }
  if (p.isSneaking && isWindmill) {
    const cfg = bearingCfg.get(key) ?? { limit: 0 };
    cfg.cw = !cfg.cw;
    bearingCfg.set(key, cfg);
    msg(p, `§aWindmill direction: ${cfg.cw ? 'reversed' : 'normal'}.`);
    if (c) setWindmillSpeed(dim.id, b.location, windmillRpm(c.sails ?? 0) * (cfg.cw ? -1 : 1));
    return true;
  }
  if (c) {
    disassemble(c);
    msg(p, '§7Structure disassembled.');
    return true;
  }
  const nc = assemble(isWindmill ? 'windmill' : 'bearing', dim, b.location, offset(b.location, f), f);
  if (!nc) {
    msg(p, '§cNothing to move: place blocks in front of the bearing (use Super Glue to connect blocks; sails stick automatically).');
    return true;
  }
  if (isWindmill) {
    const rpm = windmillRpm(nc.sails ?? 0);
    if (!rpm) msg(p, `§eWindmill needs at least 8 sails (has ${nc.sails}).`);
    const cfg = bearingCfg.get(key);
    setWindmillSpeed(dim.id, b.location, rpm * (cfg?.cw ? -1 : 1));
    msg(p, `§aWindmill assembled: ${nc.blocks.length} blocks, ${nc.sails} sails -> ${rpm} RPM.`);
  } else msg(p, `§aStructure assembled: ${nc.blocks.length} blocks.`);
  return true;
}

function tickRotating(c: Contraption): void {
  const rpm = rotatingSpeed(c);
  const step = (rpm * 6) / 20; // degrees per tick
  const cfg = bearingCfg.get(dimKey(c.dim, c.owner));
  if (c.kind === 'bearing' && cfg?.limit) {
    const target = rpm > 0 ? cfg.limit : 0;
    if (rpm === 0) return;
    const next = c.angle + step;
    if ((rpm > 0 && next >= target) || (rpm < 0 && next <= target)) {
      c.angle = target;
      updateDisplaySpeed(c, 0);
      disassemble(c);
      return;
    }
    c.angle = next;
  } else c.angle = (((c.angle + step) % 360) + 360) % 360;
  // re-anchor the client-side extrapolation regularly (all displays update in the same tick)
  c.sync = (c.sync ?? 0) + 1;
  if (c.lastRpm !== rpm || c.sync >= 10) {
    updateDisplaySpeed(c, rpm);
    c.lastRpm = rpm;
    c.sync = 0;
  }
}

function updateDisplaySpeed(c: Contraption, rpm: number): void {
  forEachDisplay(c, (e) => {
    try {
      e.setProperty('craftoria:speed', rpm);
      e.setProperty('craftoria:phase', ((c.angle % 360) + 360) % 360);
    } catch {
      /* ignore */
    }
  });
}

/** Door-mode bearings auto-assemble when their network starts turning. */
function bearingAutoAssemble(dimId: string, pos: V3, rpm: number): void {
  const key = dimKey(dimId, pos);
  const cfg = bearingCfg.get(key);
  if (!cfg?.limit || rpm === 0 || contraptionAt(dimId, pos)) return;
  const dim = dimension(dimId);
  const b = blockAt(dim, pos);
  if (!b || b.typeId !== ID('mechanical_bearing')) return;
  const f = facingOf(getStates(b));
  const resting = (bearingRest.get(key) ?? 0);
  const local = rpm * DIR_SIGN[f];
  const target = local > 0 ? cfg.limit : 0;
  if (target === resting) return;
  // structure currently sits rotated by `resting`; reassemble and continue from that angle
  const c = assemble('bearing', dim, pos, offset(pos, f), f);
  if (!c) return;
  if (resting) {
    // un-rotate stored offsets so that angle bookkeeping stays consistent
    const q = Math.round(resting / 90);
    const axis = DIR_AXIS[f];
    for (const cb of c.blocks) for (let i = 0; i < (((-q * DIR_SIGN[f]) % 4) + 4) % 4; i++) cb.o = rot90(cb.o, axis);
    c.angle = resting;
    spawnDisplays(c);
  }
  bearingRest.set(key, target);
}
const bearingRest = new Map<string, number>();

// ------------------------------------------------------------------ rope pulley / elevator
interface PulleyCfg {
  len: number; // rope length in blocks (structure top is len+1 below the pulley)
  elevator?: boolean; // elevator mode: moves only when called by an Elevator Contact
}
const pulleyStore = new BlockStore<PulleyCfg>('pul');

function setRope(key: string, len: number): void {
  const e = rotorAt(key);
  try {
    e?.setProperty(ROTOR_PROPS.p1, len);
  } catch {
    /* ignore */
  }
}

function pulleyStart(dimId: string, pos: V3, dirDown: boolean, target?: number): void {
  if (contraptionAt(dimId, pos)) return;
  const key = dimKey(dimId, pos);
  const cfg = pulleyStore.get(key) ?? { len: 0 };
  const dim = dimension(dimId);
  if (!dirDown && cfg.len <= 0) return;
  const anchor = offset(pos, 'down', cfg.len + 1);
  const ab = blockAt(dim, anchor);
  if (!ab || ab.isAir) {
    if (dirDown && cfg.len < 64) {
      // nothing attached: just pay out rope while turning (magnet goes down)
      return;
    }
    return;
  }
  const c = assemble('pulley', dim, pos, anchor, 'down');
  if (!c) return;
  c.target = target;
  persist();
}

function cellsFree(c: Contraption, delta: number, polesFree = false): boolean {
  // check the cells the structure would occupy after moving `delta` whole blocks along dir
  const dim = dimension(c.dim);
  const v = DIR_VEC[c.dir];
  const own = new Set(c.blocks.map((cb) => posKey(add(c.anchor, { x: cb.o.x + v.x * Math.round(c.move), y: cb.o.y + v.y * Math.round(c.move), z: cb.o.z + v.z * Math.round(c.move) }))));
  for (const cb of c.blocks) {
    const p = add(c.anchor, { x: cb.o.x + v.x * (Math.round(c.move) + delta), y: cb.o.y + v.y * (Math.round(c.move) + delta), z: cb.o.z + v.z * (Math.round(c.move) + delta) });
    if (own.has(posKey(p))) continue;
    const b = blockAt(dim, p);
    if (!b) return false;
    if (polesFree && b.typeId === ID('piston_pole')) continue;
    if (!(b.isAir || b.typeId === 'minecraft:air' || b.isLiquid)) return false;
  }
  return true;
}

function tickLinear(c: Contraption): void {
  const dim = dimension(c.dim);
  const rpm = speedOf(c.dim, c.owner);
  const ownerKey = dimKey(c.dim, c.owner);
  let v = 0;
  if (c.kind === 'pulley') {
    const cfg = pulleyStore.get(ownerKey) ?? { len: 0 };
    const speed = Math.abs(rpm) / 512;
    if (c.target !== undefined) {
      const goal = c.target - cfg.len; // move (blocks downward) needed
      v = Math.sign(goal - c.move) * Math.min(speed, Math.abs(goal - c.move));
      if (speed === 0) v = Math.sign(goal - c.move) * Math.min(0.05, Math.abs(goal - c.move));
    } else {
      // positive network speed lowers the structure, negative raises it
      v = rpm === 0 ? 0 : (rpm > 0 ? 1 : -1) * speed;
    }
    // limits
    const maxDown = 64 - cfg.len;
    if (c.move + v > maxDown) v = maxDown - c.move;
    if (c.move + v < -cfg.len) v = -cfg.len - c.move;
    // obstacle check before entering a new cell
    const nextCell = v > 0 ? Math.ceil(c.move + v - 1e-6) : Math.floor(c.move + v + 1e-6);
    if (v !== 0 && nextCell !== Math.round(c.move) && !cellsFree(c, nextCell - Math.round(c.move))) v = 0;
    if (v === 0 || (c.target !== undefined && Math.abs(c.target - cfg.len - c.move) < 1e-3)) {
      // settle
      c.move = Math.round(c.move);
      const len = Math.max(0, cfg.len + c.move);
      pulleyStore.set(ownerKey, { len, elevator: cfg.elevator });
      setRope(ownerKey, len);
      c.anchor = offset(c.anchor, 'down', 0);
      disassemble(c);
      return;
    }
    c.move += v;
    setRope(ownerKey, Math.max(0, cfg.len + c.move));
  } else if (c.kind === 'piston') {
    const pb = blockAt(dim, c.owner);
    if (!pb) return;
    const f = facingOf(getStates(pb));
    const maxExt = pistonMax(dim, c.owner);
    const cfg = pistonStore.get(ownerKey) ?? { ext: 0 };
    const sgn = c.dir === f ? 1 : -1;
    const local = rpm * DIR_SIGN[f];
    const want = local > 0 ? 1 : local < 0 ? -1 : 0;
    const speed = Math.abs(rpm) / 512;
    v = want === sgn ? speed : 0;
    const extNow = cfg.ext + sgn * c.move;
    if (sgn > 0 && extNow + v > maxExt) v = Math.max(0, maxExt - extNow);
    if (sgn < 0 && extNow - v < 0) v = Math.max(0, extNow);
    const nextCell = Math.ceil(c.move + v - 1e-6);
    if (v !== 0 && nextCell !== Math.round(c.move) && !cellsFree(c, nextCell - Math.round(c.move), true)) v = 0;
    if (v === 0) {
      c.move = Math.round(c.move);
      const ext = Math.max(0, Math.min(maxExt, cfg.ext + sgn * c.move));
      pistonStore.set(ownerKey, { ext });
      setPoles(dim, c.owner, f, ext);
      disassemble(c);
      return;
    }
    c.move += v;
    setPoles(dim, c.owner, f, Math.max(0, Math.floor(cfg.ext + sgn * c.move)));
  }
  // move displays + carry players standing on top
  const pivot = pivotOf(c);
  forEachDisplay(c, (e) => {
    try {
      e.teleport(pivot, { keepVelocity: false });
    } catch {
      /* ignore */
    }
  });
  carryRiders(c, v);
}

function carryRiders(c: Contraption, v: number): void {
  if (v === 0) return;
  const dim = dimension(c.dim);
  const dv = DIR_VEC[c.dir];
  const tops = new Map<string, number>();
  const base = add(c.anchor, { x: 0, y: 0, z: 0 });
  for (const cb of c.blocks) {
    const k = `${cb.o.x},${cb.o.z}`;
    tops.set(k, Math.max(tops.get(k) ?? -1e9, cb.o.y + 1));
  }
  for (const p of players()) {
    try {
      if (p.dimension.id !== c.dim) continue;
      const l = p.location;
      const lx = Math.floor(l.x - dv.x * c.move) - base.x, lz = Math.floor(l.z - dv.z * c.move) - base.z;
      const top = tops.get(`${lx},${lz}`);
      if (top === undefined) continue;
      const surface = base.y + top + dv.y * c.move;
      if (l.y < surface - 0.6 || l.y > surface + 0.8) continue;
      p.teleport({ x: l.x + dv.x * v, y: dv.y !== 0 ? surface + dv.y * v + 0.01 : l.y, z: l.z + dv.z * v }, { keepVelocity: false, checkForBlocks: false });
    } catch {
      /* ignore */
    }
  }
  void dim;
}

// ------------------------------------------------------------------ mechanical piston
interface PistonCfg {
  ext: number;
}
const pistonStore = new BlockStore<PistonCfg>('pst');

function pistonMax(dim: Dimension, pos: V3): number {
  const b = blockAt(dim, pos);
  if (!b) return 0;
  const f = facingOf(getStates(b));
  let n = 0;
  for (let i = 1; i <= 16; i++) {
    const pb = blockAt(dim, offset(pos, OPPOSITE[f], i));
    if (!pb || pb.typeId !== ID('piston_pole')) break;
    n++;
  }
  return n;
}

function setPoles(dim: Dimension, owner: V3, f: Dir, ext: number): void {
  // poles occupy owner+f .. owner+f*ext (exclusive of the structure)
  for (let i = 1; i <= 17; i++) {
    const p = offset(owner, f, i);
    const b = blockAt(dim, p);
    if (!b) break;
    if (i <= ext) {
      if (b.isAir || b.typeId === 'minecraft:air') {
        try {
          dim.setBlockType(p, ID('piston_pole'));
          const nb = blockAt(dim, p);
          if (nb) setStates(nb, { 'craftoria:axis': DIR_AXIS[f] });
        } catch {
          /* ignore */
        }
      }
    } else if (b.typeId === ID('piston_pole')) {
      try {
        dim.setBlockType(p, 'minecraft:air');
      } catch {
        /* ignore */
      }
    } else break;
  }
}

function pistonStart(dimId: string, pos: V3, rpm: number): void {
  if (contraptionAt(dimId, pos) || rpm === 0) return;
  const dim = dimension(dimId);
  const b = blockAt(dim, pos);
  if (!b) return;
  const f = facingOf(getStates(b));
  const key = dimKey(dimId, pos);
  const cfg = pistonStore.get(key) ?? { ext: 0 };
  const local = rpm * DIR_SIGN[f];
  if (local > 0 && cfg.ext >= pistonMax(dim, pos)) return;
  if (local < 0 && cfg.ext <= 0) return;
  const anchor = offset(pos, f, cfg.ext + 1);
  const ab = blockAt(dim, anchor);
  if (!ab || ab.isAir || !movable(ab)) {
    // no structure: just extend / retract the poles
    const next = Math.max(0, Math.min(pistonMax(dim, pos), cfg.ext + (local > 0 ? 1 : -1)));
    if (local > 0 && ab && !ab.isAir) return;
    pistonStore.set(key, { ext: next });
    setPoles(dim, pos, f, next);
    return;
  }
  assemble('piston', dim, pos, anchor, local > 0 ? f : OPPOSITE[f]);
}

// ------------------------------------------------------------------ elevator contacts
function contactInteract(b: Block, p: Player): boolean {
  // find a rope pulley above-ish within 16 blocks horizontally in line (same x/z column +-2)
  const dim = b.dimension;
  for (let dy = 1; dy <= 64; dy++) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const pp = { x: b.location.x + dx, y: b.location.y + dy, z: b.location.z + dz };
        const pb = blockAt(dim, pp);
        if (!pb || pb.typeId !== ID('rope_pulley')) continue;
        const key = dimKey(dim.id, pp);
        const cfg = pulleyStore.get(key) ?? { len: 0 };
        // the platform (top block of the structure) should stop level with the contact's floor
        const targetLen = Math.max(0, pp.y - b.location.y - 1);
        if (targetLen === cfg.len) {
          msg(p, '§7The elevator is already here.');
          return true;
        }
        if (speedOf(dim.id, pp) === 0) {
          msg(p, '§cThe elevator pulley has no rotational power.');
          return true;
        }
        pulleyStore.set(key, { len: cfg.len, elevator: true });
        pulleyStart(dim.id, pp, targetLen > cfg.len, targetLen);
        const c = contraptionAt(dim.id, pp);
        if (c) c.target = targetLen;
        setStates(b, { 'craftoria:powered': true });
        system.runTimeout(() => {
          const bb = blockAt(dim, b.location);
          if (bb) setStates(bb, { 'craftoria:powered': false });
        }, 30);
        sound(dim, 'craftoria.station_chime', b.center(), 0.4, 1.4);
        msg(p, '§aElevator called.');
        return true;
      }
  }
  msg(p, '§cNo rope pulley found above this contact (within 64 blocks, 2 blocks sideways).');
  return true;
}

// ------------------------------------------------------------------ registration & ticking
registerMachine([ID('mechanical_bearing'), ID('windmill_bearing')], {
  onInteract: (b, p) => {
    const held = p.getComponent('minecraft:inventory')?.container?.getItem(p.selectedSlotIndex);
    if (held && held.typeId === ID('wrench')) return false;
    return bearingInteract(b, p);
  },
  onBreak(dim, pos) {
    const c = contraptionAt(dim, pos);
    if (c) shatter(c);
    bearingCfg.delete(dimKey(dim, pos));
  },
});
registerMachine(ID('rope_pulley'), {
  onInteract(b, p) {
    const cfg = pulleyStore.get(dimKey(b.dimension.id, b.location)) ?? { len: 0 };
    const held = p.getComponent('minecraft:inventory')?.container?.getItem(p.selectedSlotIndex);
    if (held && held.typeId === ID('wrench')) return false;
    if (p.isSneaking) {
      cfg.elevator = !cfg.elevator;
      pulleyStore.set(dimKey(b.dimension.id, b.location), cfg);
      msg(p, cfg.elevator ? '§aElevator mode ON: the pulley only moves when an Elevator Contact calls it.' : '§aElevator mode OFF: the pulley follows its rotation direction.');
      return true;
    }
    msg(p, `§7Rope Pulley: rope length ${cfg.len} blocks${cfg.elevator ? ' (elevator mode)' : ''}. Turn it to raise/lower the glued structure below the rope end; place Elevator Contacts on floors to call it.`);
    return true;
  },
  onBreak(dim, pos) {
    const c = contraptionAt(dim, pos);
    if (c) disassemble(c);
    pulleyStore.delete(dimKey(dim, pos));
  },
});
registerMachine(ID('mechanical_piston'), {
  onBreak(dim, pos) {
    const c = contraptionAt(dim, pos);
    if (c) disassemble(c);
    const d = dimension(dim);
    const cfg = pistonStore.get(dimKey(dim, pos));
    if (cfg?.ext) {
      // remove poles in front
      for (const f of DIRS) {
        const p1 = offset(pos, f);
        const b = blockAt(d, p1);
        if (b?.typeId === ID('piston_pole') && getStates(b)['craftoria:axis'] === DIR_AXIS[f]) setPoles(d, pos, f, 0);
      }
    }
    pistonStore.delete(dimKey(dim, pos));
  },
});
registerMachine(ID('elevator_contact'), { onInteract: (b, p) => contactInteract(b, p) });

onSpeedChange((dim, node, _a, rpm) => {
  if (node.typeId === ID('mechanical_bearing')) bearingAutoAssemble(dim, node.pos, rpm);
  else if (node.typeId === ID('rope_pulley') && rpm !== 0 && !pulleyStore.get(dimKey(dim, node.pos))?.elevator) pulleyStart(dim, node.pos, rpm > 0);
  else if (node.typeId === ID('mechanical_piston') && rpm !== 0) pistonStart(dim, node.pos, rpm);
});

export function tickContraptions(): void {
  for (const c of [...contraptions.values()]) {
    try {
      const dim = dimension(c.dim);
      const ob = blockAt(dim, c.owner);
      if (!ob) continue; // unloaded
      if (c.ents.length === 0 && c.blocks.length) spawnDisplays(c);
      if (c.kind === 'bearing' || c.kind === 'windmill') tickRotating(c);
      else if (c.kind === 'pulley' || c.kind === 'piston') {
        tickLinear(c);
        // linear motion continues while powered: restart from the new position
        if (!contraptions.has(c.id)) {
          const rpm = speedOf(c.dim, c.owner);
          const elev = pulleyStore.get(dimKey(c.dim, c.owner))?.elevator;
          if (c.kind === 'pulley' && c.target === undefined && !elev && rpm !== 0) system.run(() => pulleyStart(c.dim, c.owner, rpm > 0));
          if (c.kind === 'piston' && rpm !== 0) system.run(() => pistonStart(c.dim, c.owner, rpm));
        }
      }
    } catch (e) {
      logError('contraption tick', e);
    }
  }
}

/** Entities loaded with a chunk that do not belong to a live contraption are removed (they are respawned from data). */
export function adoptBlockDisplay(e: Entity): void {
  try {
    const cid = e.getDynamicProperty('cr:c') as number | undefined;
    if (cid === undefined) return; // train displays are handled by trains.ts
    const c = contraptions.get(cid);
    if (!c || !c.ents.includes(e.id)) e.remove();
  } catch {
    /* ignore */
  }
}

/** periodic: rope visuals for idle pulleys */
export function refreshPulleyRopes(): void {
  for (const k of pulleyStore.loadedKeys()) setRope(k, pulleyStore.get(k)?.len ?? 0);
}

export { now };
