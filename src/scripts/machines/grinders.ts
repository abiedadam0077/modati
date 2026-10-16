// Millstone and Crushing Wheels.
// Millstone timer per Create (MIT): timer -= clamp(|rpm|/16, 1, 512) each tick.
import { Block, Dimension, Player, EntityDamageCause } from '@minecraft/server';
import { AXIS_DIRS, Axis, DIR_VEC, Dir, V3, axisUnit, cross, dimKey, offset } from '../util/vec';
import { blockAt, dimension, getStates } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, S_AXIS } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { SItem, copy, mergeInto, sameKind, toS, fromS } from '../util/items';
import { CRUSHING, MILLING, anyItemRecipe, findItemRecipe, rollOutputs } from '../recipes/processing';
import { registerMachine } from './registry';
import { registerPort, dropItem, giveItem, consumeHeld, heldItem, insertAt } from '../logistics/transport';
import { activate, tickActive } from './active';
import { particles, sound, pitchFor } from './common';

// ------------------------------------------------------------------ millstone
interface MillData {
  in?: SItem;
  out: SItem[];
  timer: number;
}
const millStore = new BlockStore<MillData>('mill');
const MILL = ID('millstone');

function millGet(key: string): MillData {
  const d = millStore.get(key);
  return d ? { in: d.in, out: d.out ?? [], timer: d.timer ?? 0 } : { out: [], timer: 0 };
}
function millSet(key: string, d: MillData): void {
  if (d.in && d.in.n <= 0) d.in = undefined;
  d.out = d.out.filter((s) => s.n > 0);
  if (!d.in && !d.out.length) millStore.delete(key);
  else millStore.set(key, d);
}

registerPort(MILL, {
  insert(b, item, face, simulate) {
    if (face === 'down' || !anyItemRecipe(MILLING, item.id)) return 0;
    const key = dimKey(b.dimension.id, b.location);
    const d = millGet(key);
    if (d.in && !sameKind(d.in, item)) return 0;
    const t = Math.min(item.n, 64 - (d.in?.n ?? 0));
    if (t <= 0) return 0;
    if (!simulate) {
      if (d.in) d.in.n += t;
      else d.in = copy(item, t);
      millSet(key, d);
      activate('mill', key);
    }
    return t;
  },
  extract(b, pred, max, _face, simulate) {
    const key = dimKey(b.dimension.id, b.location);
    const d = millGet(key);
    for (const s of d.out) {
      if (!pred(s)) continue;
      const t = Math.min(max, s.n);
      const out = copy(s, t);
      if (!simulate) {
        s.n -= t;
        millSet(key, d);
      }
      return out;
    }
    return undefined;
  },
});

registerMachine(MILL, {
  onInteract(b: Block, p: Player): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const d = millGet(key);
    const held = heldItem(p);
    if (held && anyItemRecipe(MILLING, held.typeId) && (!d.in || d.in.id === held.typeId)) {
      const s = toS(held);
      const t = Math.min(s.n, 64 - (d.in?.n ?? 0));
      if (t > 0) {
        if (d.in) d.in.n += t;
        else d.in = copy(s, t);
        consumeHeld(p, t);
        millSet(key, d);
        activate('mill', key);
      }
      return true;
    }
    if (!held && (d.out.length || d.in)) {
      for (const s of d.out) giveItem(p, s);
      d.out = [];
      if (p.isSneaking && d.in) {
        giveItem(p, d.in);
        d.in = undefined;
      }
      millSet(key, d);
      return true;
    }
    return false;
  },
  onBreak(dim, pos) {
    const key = dimKey(dim, pos);
    const d = millGet(key);
    const loc = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
    if (d.in) dropItem(dimension(dim), loc, d.in);
    for (const s of d.out) dropItem(dimension(dim), loc, s);
    millStore.delete(key);
  },
  onTick(b) {
    const key = dimKey(b.dimension.id, b.location);
    if (millStore.get(key)) activate('mill', key);
    // absorb items thrown on top
    try {
      for (const e of b.dimension.getEntities({ type: 'minecraft:item', location: { x: b.location.x + 0.5, y: b.location.y + 1.1, z: b.location.z + 0.5 }, maxDistance: 0.7 })) {
        const st = e.getComponent('minecraft:item')?.itemStack;
        if (!st || !anyItemRecipe(MILLING, st.typeId)) continue;
        const d = millGet(key);
        if (d.in && d.in.id !== st.typeId) continue;
        const s = toS(st);
        const t = Math.min(s.n, 64 - (d.in?.n ?? 0));
        if (t <= 0) continue;
        if (d.in) d.in.n += t;
        else d.in = copy(s, t);
        millSet(key, d);
        if (t >= s.n) e.remove();
        else {
          const rest = fromS(copy(s, s.n - t));
          const loc = e.location;
          e.remove();
          if (rest) b.dimension.spawnItem(rest, loc);
        }
        activate('mill', key);
      }
    } catch {
      /* ignore */
    }
  },
});

function tickMill(b: Block, key: string): boolean {
  const d = millGet(key);
  const rpm = speedOf(b.dimension.id, b.location);
  // push outputs into a receiver below
  if (d.out.length) {
    for (const s of d.out) {
      const n = insertAt(b.dimension, offset(b.location, 'down'), s, 'up');
      if (n) s.n -= n;
    }
  }
  if (!d.in) {
    millSet(key, d);
    return d.out.length > 0;
  }
  if (rpm === 0) return true;
  const r = findItemRecipe(MILLING, d.in);
  if (!r) {
    // unknown item: spit it out
    d.out.push(d.in);
    d.in = undefined;
    millSet(key, d);
    return true;
  }
  if (d.timer <= 0) d.timer = r.time;
  d.timer -= Math.max(1, Math.min(512, Math.floor(Math.abs(rpm) / 16)));
  if (d.timer <= 0) {
    const outs = rollOutputs(r.out);
    const test = d.out.map((s) => copy(s));
    let fits = true;
    for (const o of outs) if (mergeInto(test, o, 9) > 0) fits = false;
    if (fits) {
      for (const o of outs) mergeInto(d.out, o, 9);
      d.in.n -= r.in.n ?? 1;
      d.timer = 0;
    } else d.timer = 1;
  }
  const now = b.dimension.id.length + b.location.x;
  void now;
  if (Math.random() < 0.05) sound(b.dimension, 'craftoria.millstone', b.center(), 0.4, pitchFor(rpm));
  if (Math.random() < 0.2) particles(b.dimension, 'minecraft:basic_smoke_particle', { x: b.location.x + 0.5, y: b.location.y + 1.05, z: b.location.z + 0.5 }, 1, 0.6);
  millSet(key, d);
  return true;
}

// ------------------------------------------------------------------ crushing wheels
const WHEEL = ID('crushing_wheel');
interface GapState {
  buf?: SItem;
  timer: number;
}
const gaps = new Map<string, GapState>();

/** For a wheel, find its partner across a 1-block gap: returns gap position + partner + gap dir. */
export function wheelPair(dim: Dimension, pos: V3): { gap: V3; partner: V3; e: Dir } | undefined {
  const b = blockAt(dim, pos);
  if (!b || b.typeId !== WHEEL) return undefined;
  const axis = (getStates(b)[S_AXIS] as Axis) ?? 'y';
  if (axis === 'y') return undefined;
  const horizontal: Axis = axis === 'x' ? 'z' : 'x';
  for (const e of AXIS_DIRS[horizontal]) {
    const gap = offset(pos, e);
    const partner = offset(pos, e, 2);
    const pb = blockAt(dim, partner);
    if (!pb || pb.typeId !== WHEEL || getStates(pb)[S_AXIS] !== axis) continue;
    const gb = blockAt(dim, gap);
    if (!gb || !(gb.isAir || gb.typeId === 'minecraft:air')) continue;
    return { gap, partner, e };
  }
  return undefined;
}

/** Wheels must counter-rotate pulling material downwards through the gap. */
export function wheelsRunInward(axis: Axis, e: Dir, rpmA: number, rpmB: number): boolean {
  if (rpmA === 0 || rpmB === 0 || Math.sign(rpmA) === Math.sign(rpmB)) return false;
  const t = cross(axisUnit(axis), DIR_VEC[e]); // rim velocity direction at the gap side for positive rotation
  return rpmA * t.y < 0;
}

function tickWheel(b: Block, key: string): boolean {
  const dim = b.dimension;
  const rpm = speedOf(dim.id, b.location);
  if (rpm === 0) return false;
  const pair = wheelPair(dim, b.location);
  if (!pair) return true;
  // only the wheel on the negative side of the gap processes
  if (pair.e === 'south' || pair.e === 'east' ? false : true) return true;
  const axis = (getStates(b)[S_AXIS] as Axis) ?? 'x';
  const rpmB = speedOf(dim.id, pair.partner);
  if (!wheelsRunInward(axis, pair.e, rpm, rpmB)) return true;
  const gk = dimKey(dim.id, pair.gap);
  let st = gaps.get(gk);
  if (!st) gaps.set(gk, (st = { timer: 0 }));
  const g = pair.gap;
  const center = { x: g.x + 0.5, y: g.y + 0.5, z: g.z + 0.5 };
  // absorb items and hurt entities in the gap
  try {
    for (const e of dim.getEntities({ location: { x: g.x + 0.5, y: g.y + 0.9, z: g.z + 0.5 }, maxDistance: 1.0 })) {
      const l = e.location;
      if (l.x < g.x || l.x > g.x + 1 || l.z < g.z || l.z > g.z + 1 || l.y < g.y - 0.2 || l.y > g.y + 1.6) continue;
      if (e.typeId === 'minecraft:item') {
        if (st.buf) continue;
        const it = e.getComponent('minecraft:item')?.itemStack;
        if (!it) continue;
        st.buf = toS(it);
        st.timer = 0;
        e.remove();
      } else if (!e.typeId.startsWith('craftoria:')) {
        if ((Date.now() / 50) % 10 < 1.2) e.applyDamage(4, { cause: EntityDamageCause.contact });
      }
    }
  } catch {
    /* ignore */
  }
  if (!st.buf) return true;
  const r = findItemRecipe(CRUSHING, st.buf) ?? findItemRecipe(MILLING, st.buf);
  const outPos = offset(g, 'down');
  const emit = (s: SItem) => {
    const n = insertAt(dim, outPos, s, 'up');
    if (n < s.n) dropItem(dim, { x: g.x + 0.5, y: g.y - 0.1, z: g.z + 0.5 }, copy(s, s.n - n));
  };
  if (!r) {
    emit(st.buf);
    st.buf = undefined;
    return true;
  }
  st.timer += 1;
  const need = Math.max(4, Math.ceil((r.time * 8) / Math.abs(rpm)));
  if (st.timer % 10 === 0) {
    sound(dim, 'craftoria.crusher', center, 0.5, pitchFor(rpm));
    particles(dim, 'minecraft:basic_crit_particle', center, 4, 0.8);
  }
  if (st.timer >= need) {
    st.timer = 0;
    for (const o of rollOutputs(r.out)) emit(o);
    st.buf.n -= r.in.n ?? 1;
    if (st.buf.n <= 0) st.buf = undefined;
  }
  return true;
}

registerMachine(WHEEL, {
  onBreak(dim, pos) {
    // drop anything buffered in adjacent gaps
    for (const d of ['north', 'south', 'west', 'east'] as Dir[]) {
      const gk = dimKey(dim, offset(pos, d));
      const st = gaps.get(gk);
      if (st?.buf) {
        const g = offset(pos, d);
        dropItem(dimension(dim), { x: g.x + 0.5, y: g.y + 0.5, z: g.z + 0.5 }, st.buf);
      }
      gaps.delete(gk);
    }
  },
});

onSpeedChange((dim, node, _a, nb) => {
  if (nb === 0) return;
  const key = dimKey(dim, node.pos);
  if (node.typeId === WHEEL) activate('crusher', key);
  else if (node.typeId === MILL) activate('mill', key);
});

export function tickGrinders(): void {
  tickActive('mill', MILL, tickMill);
  tickActive('crusher', WHEEL, tickWheel);
}

export { fromS };
