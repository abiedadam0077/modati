// Mechanical Drill and Mechanical Saw.
// Block breaking progression ported from Create's BlockBreakingKineticBlockEntity (MIT):
//   breakSpeed = |rpm| / 100 ; every (hardness / breakSpeed) ticks progress += clamp(breakSpeed/hardness, 1, ..) ; break at 10.
import { Block, Dimension, Player, EntityDamageCause } from '@minecraft/server';
import { DIRS, Dir, V3, dimKey, offset, OPPOSITE, HORIZONTAL } from '../util/vec';
import { blockAt, dimension, getStates, runCmd } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, facingOf } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { SItem, copy, toS, fromS, sameKind, hasTag } from '../util/items';
import { CUTTING, anyItemRecipe, findItemRecipe, rollOutputs } from '../recipes/processing';
import { registerMachine } from './registry';
import { registerPort, dropItem, insertAt } from '../logistics/transport';
import { activate, tickActive } from './active';
import { particles, sound, pitchFor } from './common';
import { now } from '../core/env';

const DRILL = ID('mechanical_drill');
const SAW = ID('mechanical_saw');

const UNBREAKABLE = new Set([
  'minecraft:bedrock', 'minecraft:barrier', 'minecraft:command_block', 'minecraft:chain_command_block', 'minecraft:repeating_command_block',
  'minecraft:structure_block', 'minecraft:structure_void', 'minecraft:jigsaw', 'minecraft:end_portal_frame', 'minecraft:end_portal', 'minecraft:portal',
  'minecraft:end_gateway', 'minecraft:reinforced_deepslate', 'minecraft:light_block', 'minecraft:allow', 'minecraft:deny', 'minecraft:border_block',
  'minecraft:air', 'minecraft:water', 'minecraft:flowing_water', 'minecraft:lava', 'minecraft:flowing_lava', 'minecraft:fire', 'minecraft:soul_fire',
  'minecraft:moving_block', 'minecraft:piston_arm_collision', 'minecraft:sticky_piston_arm_collision', 'minecraft:trial_spawner', 'minecraft:vault',
  'craftoria:belt',
]);

/** Approximate vanilla hardness values (Script API does not expose block hardness). */
export function hardnessOf(typeId: string): number {
  const n = typeId.replace('minecraft:', '');
  if (UNBREAKABLE.has(typeId)) return -1;
  if (n === 'obsidian' || n === 'crying_obsidian' || n === 'respawn_anchor') return 50;
  if (n === 'ancient_debris' || n === 'netherite_block') return 30;
  if (n === 'ender_chest') return 22.5;
  if (n.endsWith('_ore')) return n.startsWith('deepslate') ? 4.5 : 3;
  if (n.includes('deepslate')) return 3.5;
  if (/(iron|gold|diamond|emerald|copper|lapis|redstone|coal)_block$/.test(n) || n === 'anvil') return 5;
  if (n.includes('stone') || n.includes('brick') || n === 'andesite' || n === 'granite' || n === 'diorite' || n === 'tuff' || n === 'calcite' || n.includes('blackstone') || n.includes('basalt')) return 1.5;
  if (n.includes('log') || n.includes('wood') || n.includes('planks') || n.includes('stem') || n.includes('hyphae') || n.includes('fence') || n.includes('chest') || n.includes('barrel') || n.includes('crafting_table')) return 2;
  if (n.includes('leaves') || n.includes('wart_block')) return 0.2;
  if (n.includes('glass')) return 0.3;
  if (n.includes('wool') || n.includes('carpet')) return 0.8;
  if (n === 'dirt' || n === 'grass_block' || n === 'sand' || n === 'red_sand' || n === 'gravel' || n === 'clay' || n === 'farmland' || n === 'mud' || n === 'podzol' || n === 'mycelium' || n === 'soul_sand' || n === 'soul_soil' || n === 'snow') return 0.6;
  if (n === 'netherrack') return 0.4;
  if (n.includes('terracotta') || n === 'hardened_clay' || n.includes('concrete')) return 1.4;
  if (n.startsWith('craftoria:')) return 2;
  if (n.includes('flower') || n.includes('grass') || n.includes('sapling') || n.includes('mushroom') || n === 'torch' || n.includes('vine') || n.includes('kelp') || n.includes('fern') || n.includes('bush')) return 0.05;
  return 1.5;
}

interface BreakState {
  target: string; // typeId being broken
  progress: number;
  wait: number;
}
const breaking = new Map<string, BreakState>();

function breakBlockWithDrops(dim: Dimension, p: V3): boolean {
  return runCmd(dim, `setblock ${p.x} ${p.y} ${p.z} air destroy`);
}

/** Generic Create-style progressive breaking. Returns true when the block broke this tick. */
function progressBreak(b: Block, key: string, target: V3, rpm: number, onBreak: (typeId: string) => void): void {
  const dim = b.dimension;
  const tb = blockAt(dim, target);
  if (!tb || tb.isAir || tb.isLiquid) {
    breaking.delete(key);
    return;
  }
  const h = hardnessOf(tb.typeId);
  if (h < 0) {
    breaking.delete(key);
    return;
  }
  let st = breaking.get(key);
  if (!st || st.target !== tb.typeId) breaking.set(key, (st = { target: tb.typeId, progress: 0, wait: 0 }));
  if (st.wait-- > 0) return;
  const breakSpeed = Math.abs(rpm) / 100;
  const hh = Math.max(h, 0.05);
  st.progress += Math.max(1, Math.min(10 - st.progress, Math.floor(breakSpeed / hh)));
  const c = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
  particles(dim, 'minecraft:basic_crit_particle', c, 2, 0.9);
  if (st.progress >= 10) {
    breaking.delete(key);
    onBreak(tb.typeId);
    return;
  }
  st.wait = Math.floor(hh / breakSpeed);
}

function hurtEntitiesIn(dim: Dimension, p: V3, dmg: number): void {
  try {
    for (const e of dim.getEntities({ location: { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, maxDistance: 0.9 })) {
      if (e.typeId === 'minecraft:item' || e.typeId.startsWith('craftoria:')) continue;
      e.applyDamage(dmg, { cause: EntityDamageCause.contact });
    }
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ drill
function tickDrill(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  if (rpm === 0) {
    breaking.delete(key);
    return false;
  }
  const f = facingOf(getStates(b));
  const target = offset(b.location, f);
  progressBreak(b, key, target, rpm, () => {
    breakBlockWithDrops(b.dimension, target);
  });
  if (now() % 10 === 0) hurtEntitiesIn(b.dimension, target, 2);
  if (breaking.has(key) && now() % 20 === 0) sound(b.dimension, 'craftoria.drill', b.center(), 0.45, pitchFor(rpm));
  return true;
}

// ------------------------------------------------------------------ saw
const SAWABLE = (id: string) =>
  hasTag(id, 'craftoria:logs') || hasTag(id, 'craftoria:stripped_logs') || /leaves|bamboo|cactus|sugar_cane|kelp|melon_block|pumpkin|vine|chorus|mushroom_block|stem$/.test(id);

function isTreeBlock(id: string): boolean {
  return hasTag(id, 'craftoria:logs') || /_leaves$|^minecraft:(warped|crimson)_stem$|wart_block|shroomlight/.test(id) || id.endsWith('_log');
}

const fellQueue: { dim: string; pos: V3 }[] = [];

/** Collect a tree (connected logs + attached leaves) like Create's tree cutter. */
function collectTree(dim: Dimension, start: V3): V3[] {
  const out: V3[] = [];
  const seen = new Set<string>();
  const q: V3[] = [start];
  while (q.length && out.length < 512) {
    const p = q.shift()!;
    const k = `${p.x},${p.y},${p.z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockAt(dim, p);
    if (!b || !isTreeBlock(b.typeId)) continue;
    out.push(p);
    const isLeaf = b.typeId.includes('leaves');
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          if (isLeaf && dy === 1 && (dx || dz)) continue;
          q.push({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
        }
  }
  return out;
}

export function tickFelling(): void {
  for (let i = 0; i < 24 && fellQueue.length; i++) {
    const job = fellQueue.shift()!;
    breakBlockWithDrops(dimension(job.dim), job.pos);
  }
}

interface SawData {
  in?: SItem;
  timer: number;
}
const sawStore = new BlockStore<SawData>('saw');

function tickSaw(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  const f = facingOf(getStates(b));
  const dim = b.dimension;
  if (f === 'up') {
    // item processing on top
    const d = sawStore.get(key) ?? { timer: 0 };
    if (!d.in) {
      try {
        for (const e of dim.getEntities({ type: 'minecraft:item', location: { x: b.location.x + 0.5, y: b.location.y + 1.1, z: b.location.z + 0.5 }, maxDistance: 0.75 })) {
          const st = e.getComponent('minecraft:item')?.itemStack;
          if (!st || !anyItemRecipe(CUTTING, st.typeId)) continue;
          d.in = toS(st);
          d.timer = 0;
          e.remove();
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (!d.in) {
      sawStore.delete(key);
      return rpm !== 0;
    }
    if (rpm === 0) {
      sawStore.set(key, d);
      return true;
    }
    const r = findItemRecipe(CUTTING, d.in);
    if (!r) {
      ejectSaw(b, d.in);
      d.in = undefined;
      sawStore.delete(key);
      return true;
    }
    d.timer += 1;
    if (d.timer % 10 === 0) {
      sound(dim, 'craftoria.saw', b.center(), 0.45, pitchFor(rpm));
      particles(dim, 'minecraft:basic_crit_particle', { x: b.location.x + 0.5, y: b.location.y + 1.1, z: b.location.z + 0.5 }, 3, 0.5);
    }
    if (d.timer >= Math.max(5, Math.ceil((r.time * 32) / Math.abs(rpm)))) {
      d.timer = 0;
      for (const o of rollOutputs(r.out)) ejectSaw(b, o);
      d.in.n -= r.in.n ?? 1;
      if (d.in.n <= 0) d.in = undefined;
    }
    if (d.in) sawStore.set(key, d);
    else sawStore.delete(key);
    return true;
  }
  if (rpm === 0) {
    breaking.delete(key);
    return false;
  }
  const target = offset(b.location, f);
  const tb = blockAt(dim, target);
  if (!tb || !SAWABLE(tb.typeId)) {
    breaking.delete(key);
    return true;
  }
  progressBreak(b, key, target, rpm, (tid) => {
    if (isTreeBlock(tid) && !tid.includes('leaves')) {
      const tree = collectTree(dim, target);
      for (const p of tree) fellQueue.push({ dim: dim.id, pos: p });
    } else breakBlockWithDrops(dim, target);
  });
  if (now() % 10 === 0) hurtEntitiesIn(dim, target, 3);
  if (breaking.has(key) && now() % 15 === 0) sound(dim, 'craftoria.saw', b.center(), 0.45, pitchFor(rpm));
  return true;
}

function ejectSaw(b: Block, s: SItem): void {
  const dim = b.dimension;
  let left = s.n;
  for (const d of HORIZONTAL as Dir[]) {
    if (left <= 0) break;
    const n = insertAt(dim, offset(b.location, d), copy(s, left), OPPOSITE[d]);
    left -= n;
  }
  if (left > 0) dropItem(dim, { x: b.location.x + 0.5, y: b.location.y + 1.3, z: b.location.z + 0.5 }, copy(s, left));
}

registerPort(SAW, {
  insert(b, item, face, simulate) {
    if (facingOf(getStates(b)) !== 'up' || face === 'down' || !anyItemRecipe(CUTTING, item.id)) return 0;
    const key = dimKey(b.dimension.id, b.location);
    const d = sawStore.get(key) ?? { timer: 0 };
    if (d.in && !sameKind(d.in, item)) return 0;
    const t = Math.min(item.n, 64 - (d.in?.n ?? 0));
    if (t <= 0) return 0;
    if (!simulate) {
      if (d.in) d.in.n += t;
      else d.in = copy(item, t);
      sawStore.set(key, d);
      activate('saw', key);
    }
    return t;
  },
});

registerMachine(SAW, {
  onBreak(dim, pos) {
    const key = dimKey(dim, pos);
    const d = sawStore.get(key);
    if (d?.in) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, d.in);
    sawStore.delete(key);
    breaking.delete(key);
  },
  onTick(b) {
    const key = dimKey(b.dimension.id, b.location);
    if (facingOf(getStates(b)) === 'up') activate('saw', key);
  },
  onInteract(_b: Block, _p: Player) {
    return false;
  },
});
registerMachine(DRILL, {
  onBreak(dim, pos) {
    breaking.delete(dimKey(dim, pos));
  },
});

onSpeedChange((dim, node, _a, nb) => {
  if (nb === 0) return;
  const key = dimKey(dim, node.pos);
  if (node.typeId === DRILL) activate('drill', key);
  else if (node.typeId === SAW) activate('saw', key);
});

export function tickBreakers(): void {
  tickActive('drill', DRILL, tickDrill);
  tickActive('saw', SAW, tickSaw);
  tickFelling();
}

export { DIRS, fromS };
