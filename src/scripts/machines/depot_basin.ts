// Depot (single processing slot) and Basin (inputs, outputs, fluids).
import { Block, BlockPermutation, Direction, Player } from '@minecraft/server';
import { Dir, V3, dimKey, offset } from '../util/vec';
import { blockAt, dimension, getStates, setState } from '../core/env';
import { BlockStore } from '../core/store';
import { ID } from '../kinetics/defs';
import { SItem, copy, mergeInto, sameKind, toS } from '../util/items';
import { registerMachine } from './registry';
import { registerPort, dropItem, giveItem, consumeHeld, heldItem, insertAt } from '../logistics/transport';
import { showItem, hidePrefix, nearAnyPlayer } from '../visuals/displays';
import { FluidId } from '../recipes/processing';
import { sound } from './common';

// ------------------------------------------------------------------ depot
export interface DepotData {
  items: SItem[]; // [0] = main slot, rest = outputs
}
export const depotStore = new BlockStore<DepotData>('dep');
const DEPOT_SLOTS = 4;

export function depotGet(key: string): DepotData {
  return depotStore.get(key) ?? { items: [] };
}
export function depotSet(key: string, d: DepotData): void {
  d.items = d.items.filter((s) => s.n > 0);
  if (!d.items.length) depotStore.delete(key);
  else depotStore.set(key, d);
}

export function refreshDepotDisplay(b: { dimension: import('@minecraft/server').Dimension; location: V3 }): void {
  const key = dimKey(b.dimension.id, b.location);
  const d = depotGet(key);
  const p = b.location;
  if (!nearAnyPlayer(b.dimension.id, p, 40)) return;
  const main = d.items[0];
  showItem(`${key}#0`, b.dimension, { x: p.x + 0.5, y: p.y + 0.72, z: p.z + 0.5 }, main?.id, 0.55, 0);
  const extra = d.items[1];
  showItem(`${key}#1`, b.dimension, { x: p.x + 0.72, y: p.y + 0.72, z: p.z + 0.72 }, extra?.id, 0.4, 0);
}

registerPort(ID('depot'), {
  insert(b, item, face, simulate) {
    if (face === 'down') return 0;
    const key = dimKey(b.dimension.id, b.location);
    const d = depotGet(key);
    if (d.items.length && !sameKind(d.items[0], item)) return 0;
    const before = d.items[0]?.n ?? 0;
    const max = 64;
    const take = Math.min(item.n, max - before);
    if (take <= 0) return 0;
    if (!simulate) {
      if (d.items[0]) d.items[0].n += take;
      else d.items.unshift(copy(item, take));
      depotSet(key, d);
      refreshDepotDisplay(b);
    }
    return take;
  },
  extract(b, pred, max, _face, simulate) {
    const key = dimKey(b.dimension.id, b.location);
    const d = depotGet(key);
    // outputs first (slots 1..), then main
    const order = [...d.items.keys()].sort((a, c) => (a === 0 ? 1 : 0) - (c === 0 ? 1 : 0));
    for (const i of order) {
      const s = d.items[i];
      if (!s || !pred(s)) continue;
      const t = Math.min(max, s.n);
      const out = copy(s, t);
      if (!simulate) {
        s.n -= t;
        depotSet(key, d);
        refreshDepotDisplay(b);
      }
      return out;
    }
    return undefined;
  },
});

/** Replace the depot main item with processing results (results go to the main slot / outputs). */
export function depotApplyResult(b: Block, consumed: number, results: SItem[]): void {
  const key = dimKey(b.dimension.id, b.location);
  const d = depotGet(key);
  if (!d.items[0]) return;
  d.items[0].n -= consumed;
  const rest = d.items[0].n > 0 ? [d.items[0]] : [];
  const outs = d.items.slice(1);
  const list: SItem[] = [];
  for (const r of results) mergeInto(outs, r, DEPOT_SLOTS);
  if (rest.length) list.push(rest[0]);
  else if (outs.length) list.push(outs.shift()!);
  list.push(...outs);
  d.items = list;
  depotSet(key, d);
  refreshDepotDisplay(b);
}

registerMachine(ID('depot'), {
  onInteract(b: Block, p: Player): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const held = heldItem(p);
    const d = depotGet(key);
    if (held && !p.isSneaking) {
      const s = toS(held);
      if (d.items.length && !sameKind(d.items[0], s)) {
        for (const it of d.items) giveItem(p, it);
        d.items = [];
      }
      const n = Math.min(s.n, 64 - (d.items[0]?.n ?? 0));
      if (n > 0) {
        if (d.items[0]) d.items[0].n += n;
        else d.items.unshift(copy(s, n));
        consumeHeld(p, n);
      }
      depotSet(key, d);
      refreshDepotDisplay(b);
      sound(b.dimension, 'craftoria.item_pop', b.center(), 0.4);
      return true;
    }
    if (d.items.length) {
      for (const it of d.items) giveItem(p, it);
      depotSet(key, { items: [] });
      refreshDepotDisplay(b);
      return true;
    }
    return false;
  },
  onBreak(dim, pos: V3) {
    const key = dimKey(dim, pos);
    const d = depotGet(key);
    for (const it of d.items) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, it);
    depotStore.delete(key);
    hidePrefix(key);
  },
  onTick(b) {
    refreshDepotDisplay(b);
  },
});

// ------------------------------------------------------------------ basin
export interface BasinData {
  items: SItem[];
  out: SItem[];
  fluids: { f: FluidId; mb: number }[];
}
export const basinStore = new BlockStore<BasinData>('bas');
export const BASIN_SLOTS = 9;
export const BASIN_FLUID_CAP = 2000;

export function basinGet(key: string): BasinData {
  const d = basinStore.get(key);
  return d ? { items: d.items ?? [], out: d.out ?? [], fluids: d.fluids ?? [] } : { items: [], out: [], fluids: [] };
}
export function basinSet(b: Block | { dimension: import('@minecraft/server').Dimension; location: V3 }, d: BasinData): void {
  const key = dimKey(b.dimension.id, b.location);
  d.items = d.items.filter((s) => s.n > 0);
  d.out = d.out.filter((s) => s.n > 0);
  d.fluids = d.fluids.filter((f) => f.mb > 0);
  if (!d.items.length && !d.out.length && !d.fluids.length) basinStore.delete(key);
  else basinStore.set(key, d);
  const blk = blockAt(b.dimension, b.location);
  if (blk) setState(blk, 'craftoria:fluid', d.fluids.length > 0);
  refreshBasinDisplay(b);
}
export function fluidTotal(d: BasinData): number {
  return d.fluids.reduce((a, f) => a + f.mb, 0);
}
export function addFluid(d: BasinData, f: FluidId, mb: number, simulate = false): number {
  const room = BASIN_FLUID_CAP - fluidTotal(d);
  const t = Math.min(room, mb);
  if (t <= 0) return 0;
  if (d.fluids.length >= 2 && !d.fluids.find((x) => x.f === f)) return 0;
  if (!simulate) {
    const ex = d.fluids.find((x) => x.f === f);
    if (ex) ex.mb += t;
    else d.fluids.push({ f, mb: t });
  }
  return t;
}

export function refreshBasinDisplay(b: { dimension: import('@minecraft/server').Dimension; location: V3 }): void {
  const key = dimKey(b.dimension.id, b.location);
  if (!nearAnyPlayer(b.dimension.id, b.location, 40)) return;
  const d = basinGet(key);
  const p = b.location;
  const shown = [...d.items, ...d.out].slice(0, 4);
  const spots = [[0.32, 0.32], [0.68, 0.32], [0.32, 0.68], [0.68, 0.68]];
  for (let i = 0; i < 4; i++) {
    const s = shown[i];
    showItem(`${key}#${i}`, b.dimension, { x: p.x + spots[i][0], y: p.y + 0.2, z: p.z + spots[i][1] }, s?.id, 0.45, 0);
  }
}

/** Push basin outputs into a receiver below (container / belt / depot / chute). */
export function pushBasinOutputs(b: Block): void {
  const key = dimKey(b.dimension.id, b.location);
  const d = basinGet(key);
  if (!d.out.length) return;
  const below = offset(b.location, 'down');
  let changed = false;
  for (const s of d.out) {
    const n = insertAt(b.dimension, below, s, 'up');
    if (n > 0) {
      s.n -= n;
      changed = true;
    }
  }
  if (changed) basinSet(b, d);
}

const BUCKET_FLUID: Record<string, FluidId> = { 'minecraft:water_bucket': 'water', 'minecraft:lava_bucket': 'lava', 'minecraft:milk_bucket': 'milk' };
export const FLUID_BUCKET: Record<FluidId, string | undefined> = { water: 'minecraft:water_bucket', lava: 'minecraft:lava_bucket', milk: 'minecraft:milk_bucket', honey: undefined };

registerPort(ID('basin'), {
  insert(b, item, face: Dir, simulate) {
    if (face === 'down') return 0;
    const key = dimKey(b.dimension.id, b.location);
    const d = basinGet(key);
    const left = mergeInto(d.items, item, BASIN_SLOTS, simulate);
    const n = item.n - left;
    if (!simulate && n > 0) basinSet(b, d);
    return n;
  },
  extract(b, pred, max, _face, simulate) {
    const key = dimKey(b.dimension.id, b.location);
    const d = basinGet(key);
    for (const s of d.out) {
      if (!pred(s)) continue;
      const t = Math.min(max, s.n);
      const out = copy(s, t);
      if (!simulate) {
        s.n -= t;
        basinSet(b, d);
      }
      return out;
    }
    return undefined;
  },
});

registerMachine(ID('basin'), {
  onInteract(b: Block, p: Player, _face: Direction): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const d = basinGet(key);
    const held = heldItem(p);
    if (held) {
      const fl = BUCKET_FLUID[held.typeId];
      if (fl) {
        if (addFluid(d, fl, 1000, true) === 1000) {
          addFluid(d, fl, 1000);
          consumeHeld(p, 1);
          giveItem(p, { id: 'minecraft:bucket', n: 1 });
          basinSet(b, d);
          sound(b.dimension, 'craftoria.item_pop', b.center(), 0.5, 0.7);
        }
        return true;
      }
      if (held.typeId === 'minecraft:bucket') {
        const f = d.fluids.find((x) => x.mb >= 1000 && FLUID_BUCKET[x.f]);
        if (f) {
          f.mb -= 1000;
          consumeHeld(p, 1);
          giveItem(p, { id: FLUID_BUCKET[f.f]!, n: 1 });
          basinSet(b, d);
        }
        return true;
      }
      if (!p.isSneaking) {
        const s = toS(held);
        const left = mergeInto(d.items, s, BASIN_SLOTS);
        const n = s.n - left;
        if (n > 0) {
          consumeHeld(p, n);
          basinSet(b, d);
          sound(b.dimension, 'craftoria.item_pop', b.center(), 0.4);
        }
        return true;
      }
    }
    // empty hand (or sneaking): take outputs first, else inputs
    const list = d.out.length ? d.out : d.items;
    if (list.length) {
      for (const s of list) giveItem(p, s);
      if (d.out.length) d.out = [];
      else d.items = [];
      basinSet(b, d);
      return true;
    }
    return false;
  },
  onBreak(dim, pos: V3, _perm: BlockPermutation) {
    const key = dimKey(dim, pos);
    const d = basinGet(key);
    for (const s of [...d.items, ...d.out]) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, s);
    basinStore.delete(key);
    hidePrefix(key);
  },
  onTick(b) {
    pushBasinOutputs(b);
    refreshBasinDisplay(b);
    void getStates;
  },
});
