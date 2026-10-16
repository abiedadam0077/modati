// Mechanical belts: placement with the belt connector, item transport, entity transport,
// processing holds under presses / deployers / spouts, output at the belt end.
// Item speed follows Create (MIT): blocks per tick = rpm / 480.
import { Block, Dimension, Player } from '@minecraft/server';
import { AXIS_DIRS, Axis, DIR_VEC, Dir, OPPOSITE, V3, dimKey, offset, parseDimKey, posKey } from '../util/vec';
import { blockAt, dimension, getStates, msg, setStates, logError, now } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, S_AXIS, S_PART } from '../kinetics/defs';
import { markTopologyDirty, onSpeedChange, speedOf } from '../kinetics/network';
import { SItem, copy, toS, fromS, sameKind } from '../util/items';
import { registerMachine } from '../machines/registry';
import { registerPort, dropItem, insertAt, consumeHeld, heldItem, giveItem } from './transport';
import { showItem, hideItem, hidePrefix, nearAnyPlayer } from '../visuals/displays';
import { activate, tickActive } from '../machines/active';
import { sound } from '../machines/common';

export const BELT = ID('belt');
export const MAX_BELT_LENGTH = 20;
const SPACING = 0.6;
const SURFACE = 13 / 16;

export interface BeltItem {
  id: number;
  s: SItem;
  p: number; // distance from the start edge along +run, 0..len
  hold?: number; // tick until which the item is held by a processor
}
interface BeltData {
  len: number;
  items: BeltItem[];
  next: number;
}
const store = new BlockStore<BeltData>('belt');
const runtime = new Map<string, { lastSave: number }>();

function runOf(axis: Axis): Axis {
  return axis === 'x' ? 'z' : 'x';
}
function runDirs(axis: Axis): [Dir, Dir] {
  return AXIS_DIRS[runOf(axis)];
}

export interface BeltInfo {
  dim: Dimension;
  start: V3;
  axis: Axis;
  len: number;
  key: string;
}

/** Locate the belt containing a segment (walks to the start segment). */
export function beltOf(dim: Dimension, seg: V3): BeltInfo | undefined {
  const b = blockAt(dim, seg);
  if (!b || b.typeId !== BELT) return undefined;
  const st = getStates(b);
  const axis = (st[S_AXIS] as Axis) ?? 'x';
  const [neg, pos] = runDirs(axis);
  let cur = seg;
  let part = st[S_PART];
  let guard = 0;
  while (part !== 'start' && guard++ < MAX_BELT_LENGTH + 2) {
    const n = offset(cur, neg);
    const nb = blockAt(dim, n);
    if (!nb || nb.typeId !== BELT || getStates(nb)[S_AXIS] !== axis) return undefined;
    cur = n;
    part = getStates(nb)[S_PART];
  }
  if (part !== 'start') return undefined;
  // length: walk forward to the end
  let len = 1;
  let p = cur;
  while (len <= MAX_BELT_LENGTH + 1) {
    const nb = blockAt(dim, p);
    if (!nb || nb.typeId !== BELT) break;
    if (getStates(nb)[S_PART] === 'end') break;
    p = offset(p, pos);
    len++;
  }
  return { dim, start: cur, axis, len, key: dimKey(dim.id, cur) };
}

function data(info: BeltInfo): BeltData {
  let d = store.get(info.key);
  if (!d) d = { len: info.len, items: [], next: 1 };
  d.len = info.len;
  return d;
}
function save(info: BeltInfo, d: BeltData): void {
  if (!d.items.length) store.delete(info.key);
  else store.set(info.key, d);
}

function segIndex(info: BeltInfo, seg: V3): number {
  const r = runOf(info.axis);
  return r === 'x' ? seg.x - info.start.x : seg.z - info.start.z;
}
function worldAt(info: BeltInfo, p: number): V3 {
  const r = runOf(info.axis);
  const s = info.start;
  return r === 'x' ? { x: s.x + p, y: s.y + SURFACE, z: s.z + 0.5 } : { x: s.x + 0.5, y: s.y + SURFACE, z: s.z + p };
}

/** +1 when items move towards +run for positive node speed */
function dirSign(info: BeltInfo, rpm: number): number {
  if (rpm === 0) return 0;
  return info.axis === 'x' ? Math.sign(rpm) : -Math.sign(rpm);
}

function canPlaceAt(d: BeltData, p: number, exceptId = -1): boolean {
  return d.items.every((it) => it.id === exceptId || Math.abs(it.p - p) >= SPACING);
}

/** Insert an item onto a belt at position p (0..len). Returns amount accepted. */
export function beltInsert(info: BeltInfo, item: SItem, p: number, simulate = false): number {
  const d = data(info);
  p = Math.max(0.25, Math.min(info.len - 0.25, p));
  if (!canPlaceAt(d, p)) return 0;
  const n = Math.min(item.n, 64);
  if (!simulate) {
    d.items.push({ id: d.next++, s: copy(item, n), p });
    save(info, d);
    activate('belt', info.key);
  }
  return n;
}

// ------------------------------------------------------------------ processing hooks (for press/deployer/spout)
export function beltItemUnder(dim: Dimension, seg: V3, pred: (s: SItem) => boolean): number | undefined {
  const info = beltOf(dim, seg);
  if (!info) return undefined;
  const d = data(info);
  const c = segIndex(info, seg) + 0.5;
  for (const it of d.items) {
    if (Math.abs(it.p - c) <= 0.32 && pred(it.s)) {
      it.p = c;
      it.hold = Number.MAX_SAFE_INTEGER;
      save(info, d);
      return it.id;
    }
  }
  return undefined;
}

export function beltRelease(dim: Dimension, seg: V3, id: number): void {
  const info = beltOf(dim, seg);
  if (!info) return;
  const d = data(info);
  const it = d.items.find((x) => x.id === id);
  if (it) {
    it.hold = 0;
    save(info, d);
  }
}

/** Replace a held item by processing results (first result stays at the spot, others queue behind). */
export function beltReplaceHeld(dim: Dimension, seg: V3, id: number, fn: (s: SItem) => { consumed: number; out: SItem[] } | undefined): boolean {
  const info = beltOf(dim, seg);
  if (!info) return false;
  const d = data(info);
  const idx = d.items.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  const it = d.items[idx];
  const r = fn(it.s);
  if (!r) return false;
  it.s.n -= r.consumed;
  const outs = r.out.filter((o) => o.n > 0);
  if (it.s.n <= 0) {
    d.items.splice(idx, 1);
    hideItem(`${info.key}#b${it.id}`);
  }
  for (const o of outs) {
    // place on the belt at the same spot, overlapping allowed for results (they spread as they move)
    d.items.push({ id: d.next++, s: o, p: it.p, hold: 0 });
  }
  save(info, d);
  return true;
}

/** Item held under a processor (read access). */
export function beltItem(dim: Dimension, seg: V3, id: number): SItem | undefined {
  const info = beltOf(dim, seg);
  if (!info) return undefined;
  return data(info).items.find((x) => x.id === id)?.s;
}

/** Processors (press / deployer / spout / fan) register predicates deciding whether to stop an item. */
type BeltProcessor = (dim: Dimension, seg: V3, item: SItem) => boolean;
const processors: BeltProcessor[] = [];
export function registerBeltProcessor(fn: BeltProcessor): void {
  processors.push(fn);
}
function processorWants(dim: Dimension, seg: V3, item: SItem): boolean {
  for (const f of processors) {
    try {
      if (f(dim, seg, item)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

// ------------------------------------------------------------------ tick
function tickBelt(b: Block, key: string): boolean {
  const dim = b.dimension;
  const info = beltOf(dim, b.location);
  if (!info || info.key !== key) return false;
  const d = data(info);
  const rpm = speedOf(dim.id, info.start);
  const sgn = dirSign(info, rpm);
  const v = (Math.abs(rpm) / 480) * sgn;
  const near = nearAnyPlayer(dim.id, info.start, 48);
  const nowMs = Date.now();
  let changed = false;
  if (v !== 0 && d.items.length) {
    // move items in order of travel so the front one moves first
    d.items.sort((a, c) => (sgn > 0 ? c.p - a.p : a.p - c.p));
    for (let i = 0; i < d.items.length; i++) {
      const it = d.items[i];
      if (it.hold && it.hold > 0) continue;
      let np = it.p + v;
      // collision with the item ahead
      const ahead = d.items[i - 1];
      if (ahead) {
        if (sgn > 0) np = Math.min(np, ahead.p - SPACING);
        else np = Math.max(np, ahead.p + SPACING);
      }
      // processing stop at the next segment center a processor is interested in
      const c = sgn > 0 ? Math.floor(it.p - 0.5) + 1.5 : Math.ceil(it.p - 0.5) - 0.5;
      if ((sgn > 0 && it.p < c && np >= c) || (sgn < 0 && it.p > c && np <= c)) {
        const segI = Math.floor(c);
        if (segI >= 0 && segI < info.len) {
          const r = runOf(info.axis);
          const segPos = r === 'x' ? { x: info.start.x + segI, y: info.start.y, z: info.start.z } : { x: info.start.x, y: info.start.y, z: info.start.z + segI };
          if (processorWants(dim, segPos, it.s)) {
            np = c;
            it.hold = 40; // the processor claims it within 40 ticks or it moves on
          }
        }
      }
      if ((sgn > 0 && np >= info.len) || (sgn < 0 && np <= 0)) {
        // reached the end: hand over
        if (outputAtEnd(info, it, sgn)) {
          d.items.splice(i, 1);
          hideItem(`${info.key}#b${it.id}`);
          i--;
          changed = true;
          continue;
        }
        np = sgn > 0 ? info.len - 0.001 : 0.001;
      }
      if (np !== it.p) {
        it.p = np;
        changed = true;
      }
    }
  }
  // decay temporary holds
  for (const it of d.items) if (it.hold && it.hold > 0 && it.hold < Number.MAX_SAFE_INTEGER) it.hold--;
  // absorb dropped items and carry entities
  if (now() % 2 === 0) absorbAndCarry(info, d, v * 2);
  if (near) for (const it of d.items) showItem(`${info.key}#b${it.id}`, dim, worldAt(info, it.p), it.s.id, 0.5, 0);
  else hidePrefix(`${info.key}#b`);
  updateBeltMotion(info, rpm);
  if (changed) {
    const rt = runtime.get(key) ?? { lastSave: 0 };
    if (nowMs - rt.lastSave > 2000) {
      rt.lastSave = nowMs;
      runtime.set(key, rt);
      save(info, d);
    } else store.set(info.key, d); // in-memory update; flushed by the store task
  }
  return d.items.length > 0 || rpm !== 0;
}

function outputAtEnd(info: BeltInfo, it: BeltItem, sgn: number): boolean {
  const [neg, pos] = runDirs(info.axis);
  const dir: Dir = sgn > 0 ? pos : neg;
  const endSeg = sgn > 0 ? offset(info.start, pos, info.len - 1) : info.start;
  const target = offset(endSeg, dir);
  const tb = blockAt(info.dim, target);
  if (!tb) return false;
  const n = insertAt(info.dim, target, it.s, OPPOSITE[dir]);
  if (n >= it.s.n) return true;
  if (n > 0) {
    it.s.n -= n;
    return false;
  }
  if (tb.isAir || tb.typeId === 'minecraft:air') {
    const v = DIR_VEC[dir];
    const loc = { x: target.x + 0.5 - v.x * 0.3, y: target.y + 0.5, z: target.z + 0.5 - v.z * 0.3 };
    const st = fromS(it.s);
    if (st) {
      try {
        const e = info.dim.spawnItem(st, loc);
        e.clearVelocity();
        e.applyImpulse({ x: v.x * 0.12, y: 0.05, z: v.z * 0.12 });
      } catch {
        dropItem(info.dim, loc, it.s);
      }
    }
    return true;
  }
  return false;
}

function absorbAndCarry(info: BeltInfo, d: BeltData, v: number): void {
  const r = runOf(info.axis);
  const s = info.start;
  const minX = s.x, minZ = s.z;
  const maxX = r === 'x' ? s.x + info.len : s.x + 1;
  const maxZ = r === 'z' ? s.z + info.len : s.z + 1;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  let ents;
  try {
    ents = info.dim.getEntities({ location: { x: cx, y: s.y + 1, z: cz }, maxDistance: info.len / 2 + 1.2 });
  } catch {
    return;
  }
  for (const e of ents) {
    try {
      const l = e.location;
      if (l.x < minX || l.x > maxX || l.z < minZ || l.z > maxZ) continue;
      if (l.y < s.y + 0.55 || l.y > s.y + 1.3) continue;
      if (e.typeId === 'minecraft:item') {
        const st = e.getComponent('minecraft:item')?.itemStack;
        if (!st) continue;
        const p = r === 'x' ? l.x - s.x : l.z - s.z;
        const pp = Math.max(0.25, Math.min(info.len - 0.25, p));
        if (!canPlaceAt(d, pp)) continue;
        d.items.push({ id: d.next++, s: toS(st), p: pp });
        e.remove();
        continue;
      }
      if (e.typeId.startsWith('craftoria:') || v === 0) continue;
      // carry mobs and players standing on the belt
      if (l.y > s.y + SURFACE + 0.35) continue;
      const dx = r === 'x' ? v : 0, dz = r === 'z' ? v : 0;
      e.teleport({ x: l.x + dx, y: l.y, z: l.z + dz }, { keepVelocity: true, checkForBlocks: true });
    } catch {
      /* entity gone */
    }
  }
}

const lastMotion = new Map<string, number>();
function motionTier(rpm: number): number {
  const a = Math.abs(rpm);
  if (a === 0) return 0;
  if (a < 24) return 1;
  if (a < 56) return 2;
  if (a < 112) return 3;
  return 4;
}
function updateBeltMotion(info: BeltInfo, rpm: number): void {
  const sgn = dirSign(info, rpm);
  const tier = motionTier(rpm);
  const m = tier === 0 ? 0 : sgn > 0 ? tier : tier + 4;
  if (lastMotion.get(info.key) === m) return;
  lastMotion.set(info.key, m);
  const [, pos] = runDirs(info.axis);
  for (let i = 0; i < info.len; i++) {
    const b = blockAt(info.dim, offset(info.start, pos, i));
    if (b && b.typeId === BELT) setStates(b, { 'craftoria:motion': m });
  }
}

// ------------------------------------------------------------------ placement / removal
const pending = new Map<string, { dim: string; pos: V3; axis: Axis }>();

function isShaftLike(typeId: string): boolean {
  return typeId === ID('shaft');
}

/** Belt connector used on a block (shaft). Returns true when consumed. */
export function useBeltConnector(p: Player, b: Block): boolean {
  if (!isShaftLike(b.typeId)) {
    msg(p, '§eMechanical Belt: click two shafts (same axis, horizontal, in line).');
    return true;
  }
  const axis = (getStates(b)[S_AXIS] as Axis) ?? 'y';
  if (axis === 'y') {
    msg(p, '§cBelts need horizontal shafts (vertical/sloped belts are not supported in this version).');
    return true;
  }
  const first = pending.get(p.id);
  if (!first || first.dim !== b.dimension.id) {
    pending.set(p.id, { dim: b.dimension.id, pos: { ...b.location }, axis });
    msg(p, '§aFirst shaft selected. Now click the second shaft.');
    sound(b.dimension, 'craftoria.wrench', b.center(), 0.5, 1.2);
    return true;
  }
  pending.delete(p.id);
  const a = first.pos, c = b.location;
  const run = runOf(axis);
  const sameLine = first.axis === axis && a.y === c.y && (run === 'x' ? a.z === c.z : a.x === c.x);
  const len = Math.abs(run === 'x' ? c.x - a.x : c.z - a.z) + 1;
  if (!sameLine || len < 2) {
    msg(p, '§cShafts must share the same axis and lie on one horizontal line across the shaft axis.');
    return true;
  }
  if (len > MAX_BELT_LENGTH) {
    msg(p, `§cBelt too long (max ${MAX_BELT_LENGTH} blocks).`);
    return true;
  }
  const dim = b.dimension;
  const [, pos] = runDirs(axis);
  const start = (run === 'x' ? a.x <= c.x : a.z <= c.z) ? a : c;
  for (let i = 1; i < len - 1; i++) {
    const m = blockAt(dim, offset(start, pos, i));
    if (!m || !(m.isAir || m.typeId === 'minecraft:air')) {
      msg(p, '§cThe space between the shafts must be empty.');
      return true;
    }
  }
  const cost = Math.ceil(len / 2);
  const held = heldItem(p);
  const creative = (() => {
    try {
      return p.getGameMode() === 'Creative';
    } catch {
      return false;
    }
  })();
  if (!creative && (!held || held.typeId !== ID('belt_connector') || held.amount < cost)) {
    msg(p, `§cThis belt needs ${cost} Mechanical Belt items.`);
    return true;
  }
  for (let i = 0; i < len; i++) {
    const segPos = offset(start, pos, i);
    const part = i === 0 ? 'start' : i === len - 1 ? 'end' : 'middle';
    try {
      dim.setBlockType(segPos, BELT);
      const sb = blockAt(dim, segPos);
      if (sb) setStates(sb, { [S_AXIS]: axis, [S_PART]: part });
      markTopologyDirty(dim.id, segPos);
    } catch (e) {
      logError('belt place', e);
    }
  }
  consumeHeld(p, cost);
  sound(dim, 'craftoria.wrench', b.center(), 0.6, 0.8);
  msg(p, `§aBelt placed (${len} blocks).`);
  return true;
}

/** Remove an entire belt when one segment is broken: pulleys become shafts again. */
function breakBelt(dimId: string, pos: V3, axis: Axis): void {
  const dim = dimension(dimId);
  const [neg, posD] = runDirs(axis);
  const segs: V3[] = [];
  for (const d of [neg, posD]) {
    let cur = offset(pos, d);
    for (let i = 0; i < MAX_BELT_LENGTH + 1; i++) {
      const b = blockAt(dim, cur);
      if (!b || b.typeId !== BELT || getStates(b)[S_AXIS] !== axis) break;
      segs.push(cur);
      cur = offset(cur, d);
    }
  }
  const all = [pos, ...segs];
  // items of the belt (stored at the start)
  let minP = all[0];
  for (const s of all) if ((runOf(axis) === 'x' ? s.x < minP.x : s.z < minP.z)) minP = s;
  const key = dimKey(dimId, minP);
  const d = store.get(key);
  if (d) {
    for (const it of d.items) {
      const r = runOf(axis);
      const loc = r === 'x' ? { x: minP.x + it.p, y: minP.y + 0.9, z: minP.z + 0.5 } : { x: minP.x + 0.5, y: minP.y + 0.9, z: minP.z + it.p };
      dropItem(dim, loc, it.s);
    }
    store.delete(key);
  }
  hidePrefix(`${key}#b`);
  const total = all.length;
  for (const s of segs) {
    const b = blockAt(dim, s);
    const part = b ? getStates(b)[S_PART] : 'middle';
    if (part === 'start' || part === 'end') {
      dim.setBlockType(s, ID('shaft'));
      const sb = blockAt(dim, s);
      if (sb) setStates(sb, { [S_AXIS]: axis });
    } else dim.setBlockType(s, 'minecraft:air');
    markTopologyDirty(dimId, s);
  }
  dropItem(dim, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, { id: ID('belt_connector'), n: Math.max(1, Math.ceil(total / 2)) });
}

registerPort(BELT, {
  insert(b, item, face, simulate) {
    const info = beltOf(b.dimension, b.location);
    if (!info) return 0;
    const i = segIndex(info, b.location);
    const [neg, pos] = runDirs(info.axis);
    let p = i + 0.5;
    if (face === neg) p = i + 0.2;
    else if (face === pos) p = i + 0.8;
    return beltInsert(info, item, p, simulate);
  },
  extract(b, pred, max, _face, simulate) {
    const info = beltOf(b.dimension, b.location);
    if (!info) return undefined;
    const d = data(info);
    const c = segIndex(info, b.location) + 0.5;
    let best: BeltItem | undefined;
    for (const it of d.items) if (pred(it.s) && Math.abs(it.p - c) <= 0.5 && (!best || Math.abs(it.p - c) < Math.abs(best.p - c))) best = it;
    if (!best) return undefined;
    const t = Math.min(max, best.s.n);
    const out = copy(best.s, t);
    if (!simulate) {
      best.s.n -= t;
      if (best.s.n <= 0) {
        d.items = d.items.filter((x) => x !== best);
        hideItem(`${info.key}#b${best.id}`);
      }
      save(info, d);
    }
    return out;
  },
});

registerMachine(BELT, {
  onInteract(b: Block, p: Player): boolean {
    const info = beltOf(b.dimension, b.location);
    if (!info) return false;
    const held = heldItem(p);
    const d = data(info);
    const c = segIndex(info, b.location) + 0.5;
    if (held && held.typeId !== ID('wrench') && held.typeId !== ID('belt_connector')) {
      const s = toS(held);
      const n = beltInsert(info, s, c);
      if (n > 0) consumeHeld(p, n);
      return true;
    }
    if (!held) {
      // take items from this segment
      const mine = d.items.filter((it) => Math.abs(it.p - c) <= 0.5);
      if (!mine.length) return false;
      for (const it of mine) {
        giveItem(p, it.s);
        hideItem(`${info.key}#b${it.id}`);
      }
      d.items = d.items.filter((it) => !mine.includes(it));
      save(info, d);
      return true;
    }
    return false;
  },
  onBreak(dim, pos, perm) {
    const axis = ((perm.getState(S_AXIS as never) as unknown) as Axis) ?? 'x';
    breakBelt(dim, pos, axis);
  },
  onTick(b) {
    const info = beltOf(b.dimension, b.location);
    if (info && (store.get(info.key) || speedOf(b.dimension.id, info.start) !== 0)) activate('belt', info.key);
  },
});

onSpeedChange((dim, node, _a, nb) => {
  if (node.typeId !== BELT) return;
  const d = dimension(dim);
  const info = beltOf(d, node.pos);
  if (info) {
    activate('belt', info.key);
    if (nb === 0) updateBeltMotion(info, 0);
  }
});

export function tickBelts(): void {
  tickActive('belt', BELT, tickBelt);
}

export function beltItemCount(key: string): number {
  return store.get(key)?.items.length ?? 0;
}

export { sameKind, posKey, parseDimKey };
