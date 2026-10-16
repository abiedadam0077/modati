// Fluids: pipes, mechanical pumps, fluid tanks, spouts and basin fluid I/O.
// Simplified but fully functional: a pump moves fluid from the network on its input side to the
// network on its output side (direction set by the rotation direction, like Create).
import { Block, Dimension, Player } from '@minecraft/server';
import { DIRS, DIR_SIGN, Dir, OPPOSITE, V3, dimKey, offset, posKey } from '../util/vec';
import { blockAt, dimension, getStates, msg, setState, setStates, now } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, facingOf } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { FluidId, findFill, rollOutputs, FILLING, matches } from '../recipes/processing';
import { registerMachine } from '../machines/registry';
import { consumeHeld, giveItem, heldItem } from '../logistics/transport';
import { activate, tickActive } from '../machines/active';
import { addFluid, basinGet, basinSet, depotApplyResult, depotGet, FLUID_BUCKET } from '../machines/depot_basin';
import { beltItemUnder, beltRelease, beltReplaceHeld, registerBeltProcessor, beltItem } from '../logistics/belt_api';
import { particles, sound } from '../machines/common';
import { SItem } from '../util/items';

const PIPE = ID('fluid_pipe');
const PUMP = ID('mechanical_pump');
const TANK = ID('fluid_tank');
const SPOUT = ID('spout');
const BASIN = ID('basin');
export const TANK_CAP = 8000;
export const SPOUT_CAP = 1000;

interface TankData {
  f?: FluidId;
  mb: number;
}
const tankStore = new BlockStore<TankData>('tank');
const spoutStore = new BlockStore<TankData>('spout');

const BUCKET_FLUID: Record<string, FluidId> = { 'minecraft:water_bucket': 'water', 'minecraft:lava_bucket': 'lava', 'minecraft:milk_bucket': 'milk' };

function tankOf(typeId: string): BlockStore<TankData> | undefined {
  return typeId === TANK ? tankStore : typeId === SPOUT ? spoutStore : undefined;
}
function capOf(typeId: string): number {
  return typeId === TANK ? TANK_CAP : SPOUT_CAP;
}

function setTankVisual(b: Block, d: TankData): void {
  if (b.typeId === TANK) setState(b, 'craftoria:level', d.mb <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((d.mb / TANK_CAP) * 4))));
}

// ------------------------------------------------------------------ generic fluid endpoints
interface Endpoint {
  kind: 'tank' | 'basin' | 'world';
  pos: V3;
  face?: Dir;
}

/** Amount of fluid `f` available (or any fluid when f undefined) at an endpoint */
function available(dim: Dimension, ep: Endpoint): { f: FluidId; mb: number } | undefined {
  if (ep.kind === 'tank') {
    const b = blockAt(dim, ep.pos);
    const st = b && tankOf(b.typeId);
    const d = st?.get(dimKey(dim.id, ep.pos));
    return d?.f && d.mb > 0 ? { f: d.f, mb: d.mb } : undefined;
  }
  if (ep.kind === 'basin') {
    const d = basinGet(dimKey(dim.id, ep.pos));
    const f = d.fluids[0];
    return f ? { f: f.f, mb: f.mb } : undefined;
  }
  const b = blockAt(dim, ep.pos);
  if (!b) return undefined;
  const depth = b.permutation.getState('liquid_depth' as never) as unknown as number | undefined;
  if ((b.typeId === 'minecraft:water' || b.typeId === 'minecraft:flowing_water') && depth === 0) return { f: 'water', mb: 1e9 };
  if ((b.typeId === 'minecraft:lava' || b.typeId === 'minecraft:flowing_lava') && depth === 0) return { f: 'lava', mb: 1000 };
  return undefined;
}

function take(dim: Dimension, ep: Endpoint, f: FluidId, mb: number): number {
  if (ep.kind === 'tank') {
    const b = blockAt(dim, ep.pos)!;
    const st = tankOf(b.typeId)!;
    const key = dimKey(dim.id, ep.pos);
    const d = st.get(key);
    if (!d || d.f !== f) return 0;
    const t = Math.min(mb, d.mb);
    d.mb -= t;
    if (d.mb <= 0) st.delete(key);
    else st.set(key, d);
    setTankVisual(b, d);
    return t;
  }
  if (ep.kind === 'basin') {
    const b = blockAt(dim, ep.pos)!;
    const d = basinGet(dimKey(dim.id, ep.pos));
    const fl = d.fluids.find((x) => x.f === f);
    if (!fl) return 0;
    const t = Math.min(mb, fl.mb);
    fl.mb -= t;
    basinSet(b, d);
    return t;
  }
  // world source block: water infinite, lava consumed after 1000 mb drawn
  if (f === 'lava') {
    if (mb < 1000) return 0;
    try {
      dim.setBlockType(ep.pos, 'minecraft:air');
    } catch {
      return 0;
    }
    return 1000;
  }
  return mb;
}

function space(dim: Dimension, ep: Endpoint, f: FluidId): number {
  if (ep.kind === 'tank') {
    const b = blockAt(dim, ep.pos);
    const st = b && tankOf(b.typeId);
    if (!st || !b) return 0;
    const d = st.get(dimKey(dim.id, ep.pos));
    if (d?.f && d.f !== f && d.mb > 0) return 0;
    return capOf(b.typeId) - (d?.mb ?? 0);
  }
  if (ep.kind === 'basin') return addFluid(basinGet(dimKey(dim.id, ep.pos)), f, 1e9, true);
  const b = blockAt(dim, ep.pos);
  return b && (b.isAir || b.typeId === 'minecraft:air') && f !== 'milk' && f !== 'honey' ? 1000 : 0;
}

function put(dim: Dimension, ep: Endpoint, f: FluidId, mb: number): number {
  if (ep.kind === 'tank') {
    const b = blockAt(dim, ep.pos)!;
    const st = tankOf(b.typeId)!;
    const key = dimKey(dim.id, ep.pos);
    const d = st.get(key) ?? { f, mb: 0 };
    if (d.f && d.f !== f && d.mb > 0) return 0;
    const t = Math.min(mb, capOf(b.typeId) - d.mb);
    d.f = f;
    d.mb += t;
    st.set(key, d);
    setTankVisual(b, d);
    return t;
  }
  if (ep.kind === 'basin') {
    const b = blockAt(dim, ep.pos)!;
    const d = basinGet(dimKey(dim.id, ep.pos));
    const t = addFluid(d, f, mb);
    basinSet(b, d);
    return t;
  }
  if (mb < 1000) return 0;
  try {
    dim.setBlockType(ep.pos, f === 'lava' ? 'minecraft:lava' : 'minecraft:water');
    return 1000;
  } catch {
    return 0;
  }
}

/** Walk pipes from `start` (block adjacent to the pump face) collecting endpoints. */
function collectEndpoints(dim: Dimension, start: V3, fromDir: Dir): Endpoint[] {
  const out: Endpoint[] = [];
  const seen = new Set<string>();
  const queue: { p: V3; from: Dir }[] = [{ p: start, from: fromDir }];
  while (queue.length && seen.size < 64) {
    const { p, from } = queue.shift()!;
    const k = posKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockAt(dim, p);
    if (!b) continue;
    if (b.typeId === PIPE) {
      for (const d of DIRS) if (d !== OPPOSITE[from]) queue.push({ p: offset(p, d), from: d });
      continue;
    }
    if (b.typeId === TANK || b.typeId === SPOUT) out.push({ kind: 'tank', pos: p });
    else if (b.typeId === BASIN) out.push({ kind: 'basin', pos: p });
    else if (b.isAir || b.isLiquid || b.typeId === 'minecraft:air') out.push({ kind: 'world', pos: p, face: from });
  }
  return out;
}

function tickPump(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  if (rpm === 0) return false;
  if (now() % 4 !== 0) return true;
  const dim = b.dimension;
  const f = facingOf(getStates(b));
  const forward = rpm * DIR_SIGN[f] > 0;
  const outDir: Dir = forward ? f : OPPOSITE[f];
  const inDir: Dir = OPPOSITE[outDir];
  const sources = collectEndpoints(dim, offset(b.location, inDir), inDir);
  const sinks = collectEndpoints(dim, offset(b.location, outDir), outDir);
  let budget = Math.ceil(Math.abs(rpm) / 4) * 4;
  for (const src of sources) {
    if (budget <= 0) break;
    const av = available(dim, src);
    if (!av) continue;
    for (const dst of sinks) {
      if (budget <= 0) break;
      if (dst.kind === src.kind && dst.pos.x === src.pos.x && dst.pos.y === src.pos.y && dst.pos.z === src.pos.z) continue;
      const room = space(dim, dst, av.f);
      if (room <= 0) continue;
      let amount = Math.min(budget, av.mb, room);
      if (dst.kind === 'world' || src.kind === 'world' && av.f === 'lava') {
        if (amount < 1000 && !(src.kind === 'world' && av.f === 'water')) continue;
        if (dst.kind === 'world') amount = 1000;
      }
      const got = take(dim, src, av.f, amount);
      if (got <= 0) continue;
      const placed = put(dim, dst, av.f, got);
      if (placed < got && src.kind !== 'world') put(dim, src, av.f, got - placed);
      budget -= got;
      break;
    }
  }
  if (now() % 40 === 0) sound(dim, 'craftoria.pump', b.center(), 0.3, 0.9);
  return true;
}

// ------------------------------------------------------------------ pipes: visual connections
function connects(dim: Dimension, p: V3): boolean {
  const b = blockAt(dim, p);
  if (!b) return false;
  return b.typeId === PIPE || b.typeId === PUMP || b.typeId === TANK || b.typeId === SPOUT || b.typeId === BASIN;
}
export function updatePipe(b: Block): void {
  const vals: Record<string, boolean> = {};
  for (const d of DIRS) vals[`craftoria:c_${d}`] = connects(b.dimension, offset(b.location, d));
  setStates(b, vals);
}
function updateAround(dim: Dimension, p: V3): void {
  for (const d of DIRS) {
    const n = blockAt(dim, offset(p, d));
    if (n && n.typeId === PIPE) updatePipe(n);
  }
}

// ------------------------------------------------------------------ tanks & spouts interaction
function tankInteract(b: Block, p: Player): boolean {
  const st = tankOf(b.typeId)!;
  const key = dimKey(b.dimension.id, b.location);
  const d = st.get(key) ?? { mb: 0 };
  const held = heldItem(p);
  const cap = capOf(b.typeId);
  if (held) {
    const fl = BUCKET_FLUID[held.typeId];
    if (fl && (!d.f || d.f === fl || d.mb <= 0) && d.mb + 1000 <= cap) {
      d.f = fl;
      d.mb += 1000;
      st.set(key, d);
      consumeHeld(p, 1);
      giveItem(p, { id: 'minecraft:bucket', n: 1 });
      setTankVisual(b, d);
      sound(b.dimension, 'craftoria.item_pop', b.center(), 0.5, 0.7);
      return true;
    }
    if (held.typeId === 'minecraft:bucket' && d.f && d.mb >= 1000 && FLUID_BUCKET[d.f]) {
      d.mb -= 1000;
      const f = d.f;
      if (d.mb <= 0) st.delete(key);
      else st.set(key, d);
      consumeHeld(p, 1);
      giveItem(p, { id: FLUID_BUCKET[f]!, n: 1 });
      setTankVisual(b, d);
      return true;
    }
    if (held.typeId === 'minecraft:glass_bottle' && d.f === 'water' && d.mb >= 250) {
      d.mb -= 250;
      if (d.mb <= 0) st.delete(key);
      else st.set(key, d);
      consumeHeld(p, 1);
      giveItem(p, { id: 'minecraft:potion', n: 1 });
      setTankVisual(b, d);
      return true;
    }
    if (held.typeId === ID('wrench')) return false;
  }
  msg(p, d.f && d.mb > 0 ? `§b${d.f}: §f${d.mb} / ${cap} mB` : `§7Empty (${cap} mB capacity)`);
  return true;
}

// ------------------------------------------------------------------ spout filling
interface SpoutRun {
  t: number;
  target?: { kind: 'depot' | 'belt'; pos: V3; id?: number };
}
const spoutRuns = new Map<string, SpoutRun>();

function tickSpout(b: Block, key: string): boolean {
  const d = spoutStore.get(key);
  if (!d?.f || d.mb <= 0) return false;
  const dim = b.dimension;
  let run = spoutRuns.get(key);
  if (!run) spoutRuns.set(key, (run = { t: 0 }));
  if (!run.target) {
    if (now() % 4 !== 0) return true;
    for (const dist of [1, 2]) {
      const p = offset(b.location, 'down', dist);
      const tb = blockAt(dim, p);
      if (!tb) continue;
      if (tb.typeId === ID('depot')) {
        const main = depotGet(dimKey(dim.id, p)).items[0];
        if (main && findFill(main, d.f, d.mb)) run.target = { kind: 'depot', pos: p };
        break;
      }
      if (tb.typeId === ID('belt')) {
        const id = beltItemUnder(dim, p, (s) => !!findFill(s, d.f!, d.mb));
        if (id !== undefined) run.target = { kind: 'belt', pos: p, id };
        break;
      }
      if (!tb.isAir) break;
    }
    if (!run.target) return true;
    run.t = 0;
  }
  run.t++;
  const tp = run.target.pos;
  if (run.t % 5 === 0) particles(dim, d.f === 'lava' ? 'minecraft:lava_drip_particle' : 'minecraft:water_drip_particle', { x: tp.x + 0.5, y: tp.y + 1.1, z: tp.z + 0.5 }, 2, 0.2);
  if (run.t < 20) return true;
  const fluid = d.f;
  if (run.target.kind === 'depot') {
    const db = blockAt(dim, tp);
    const main = depotGet(dimKey(dim.id, tp)).items[0];
    const r = main && findFill(main, fluid, d.mb);
    if (db && r) {
      depotApplyResult(db, 1, rollOutputs(r.out));
      d.mb -= r.fluid.mb;
    }
  } else if (run.target.id !== undefined) {
    const s = beltItem(dim, tp, run.target.id);
    const r = s && findFill(s, fluid, d.mb);
    if (r) {
      beltReplaceHeld(dim, tp, run.target.id, () => ({ consumed: 1, out: rollOutputs(r.out) }));
      d.mb -= r.fluid.mb;
    }
    beltRelease(dim, tp, run.target.id);
  }
  sound(dim, 'craftoria.item_pop', { x: tp.x + 0.5, y: tp.y + 1, z: tp.z + 0.5 }, 0.4, 0.8);
  if (d.mb <= 0) spoutStore.delete(key);
  else spoutStore.set(key, d);
  run.target = undefined;
  return true;
}

registerBeltProcessor((dim, seg, item) => {
  for (const dist of [1, 2]) {
    const sb = blockAt(dim, offset(seg, 'up', dist));
    if (!sb) continue;
    if (sb.typeId !== SPOUT) {
      if (!sb.isAir) return false;
      continue;
    }
    const d = spoutStore.get(dimKey(dim.id, sb.location));
    return !!(d?.f && findFill(item, d.f, d.mb));
  }
  return false;
});

// ------------------------------------------------------------------ registration
registerMachine(PIPE, {
  onPlace(b) {
    updatePipe(b);
    updateAround(b.dimension, b.location);
  },
  onBreak(dim, pos) {
    updateAround(dimension(dim), pos);
  },
  onTick(b) {
    updatePipe(b);
  },
});
registerMachine([TANK, SPOUT], {
  onPlace(b) {
    updateAround(b.dimension, b.location);
  },
  onInteract: (b, p) => {
    const r = tankInteract(b, p);
    if (b.typeId === SPOUT) activate('spout', dimKey(b.dimension.id, b.location));
    return r;
  },
  onBreak(dim, pos) {
    tankStore.delete(dimKey(dim, pos));
    spoutStore.delete(dimKey(dim, pos));
    updateAround(dimension(dim), pos);
  },
  onTick(b) {
    if (b.typeId === SPOUT) {
      const d = spoutStore.get(dimKey(b.dimension.id, b.location));
      if (d && d.mb > 0) activate('spout', dimKey(b.dimension.id, b.location));
    }
  },
});
registerMachine(PUMP, {
  onPlace(b) {
    updateAround(b.dimension, b.location);
  },
  onBreak(dim, pos) {
    updateAround(dimension(dim), pos);
  },
});
registerMachine(BASIN, {
  onPlace(b) {
    updateAround(b.dimension, b.location);
  },
});

onSpeedChange((dim, node, _a, nb) => {
  if (nb !== 0 && node.typeId === PUMP) activate('pump', dimKey(dim, node.pos));
});

export function tickFluids(): void {
  tickActive('pump', PUMP, tickPump);
  tickActive('spout', SPOUT, tickSpout);
}

export function tankInfo(typeId: string, key: string): TankData | undefined {
  return tankOf(typeId)?.get(key);
}

export { FILLING, matches };
export type { SItem };
