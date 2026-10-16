// Deployer (item application, block placing, bone meal, attacking) and Encased Fan
// (entity push/pull, bulk washing with water, bulk smelting with lava/fire/campfire).
import { Block, BlockPermutation, Dimension, Entity, Player, EntityDamageCause } from '@minecraft/server';
import { DIR_SIGN, DIR_VEC, Dir, V3, dimKey, offset } from '../util/vec';
import { blockAt, dimension, getStates, setStates } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, facingOf } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { SItem, copy, toS, fromS } from '../util/items';
import { DEPLOYING, SMELTING, WASHING, findDeploy, findItemRecipe, rollOutputs, matches } from '../recipes/processing';
import { registerMachine } from './registry';
import { dropItem, giveItem, consumeHeld, heldItem } from '../logistics/transport';
import { activate, tickActive } from './active';
import { depotApplyResult, depotGet } from './depot_basin';
import { beltItemUnder, beltRelease, beltReplaceHeld, registerBeltProcessor, beltOf } from '../logistics/belt_api';
import { particles, sound } from './common';
import { rotorAt, ROTOR_PROPS, onRotorConfigured } from '../visuals/rotors';
import { now, logError } from '../core/env';

// ------------------------------------------------------------------ deployer
const DEPLOYER = ID('deployer');
interface DeployerData {
  held?: SItem;
}
const depStore = new BlockStore<DeployerData>('dply');
interface DeployerState {
  phase: 'idle' | 'out' | 'back';
  t: number;
  len: number;
  belt?: { pos: V3; id: number };
}
const deployers = new Map<string, DeployerState>();

function setHand(key: string, item: SItem | undefined): void {
  const e = rotorAt(key);
  if (!e) return;
  try {
    e.runCommand(item ? `replaceitem entity @s slot.weapon.mainhand 0 ${item.id} 1` : 'replaceitem entity @s slot.weapon.mainhand 0 air');
  } catch {
    /* ignore */
  }
}

onRotorConfigured((key, _e, _st, typeId) => {
  if (typeId === DEPLOYER) setHand(key, depStore.get(key)?.held);
});

function weaponDamage(id: string | undefined): number {
  if (!id) return 1;
  const n = id.replace('minecraft:', '');
  const base: Record<string, number> = { wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7, netherite: 8 };
  for (const [k, v] of Object.entries(base)) if (n.startsWith(k)) return n.endsWith('_sword') ? v : n.endsWith('_axe') ? v + 1 : 1;
  return n === 'trident' ? 9 : n === 'mace' ? 6 : 1;
}

function tryBlockPlace(dim: Dimension, pos: V3, held: SItem): boolean {
  const b = blockAt(dim, pos);
  if (!b || !(b.isAir || b.typeId === 'minecraft:air')) return false;
  try {
    const perm = BlockPermutation.resolve(held.id);
    b.setPermutation(perm);
    return true;
  } catch {
    return false;
  }
}

const CROPS = new Set(['minecraft:wheat', 'minecraft:carrots', 'minecraft:potatoes', 'minecraft:beetroot']);
function tryBoneMeal(dim: Dimension, pos: V3): boolean {
  const b = blockAt(dim, pos);
  if (!b || !CROPS.has(b.typeId)) return false;
  const g = getStates(b)['growth'];
  if (typeof g !== 'number' || g >= 7) return false;
  setStates(b, { growth: Math.min(7, g + 2 + Math.floor(Math.random() * 3)) });
  particles(dim, 'minecraft:crop_growth_emitter', { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, 1, 0);
  return true;
}

/** Find work for a deployer; returns a description of the action or undefined. */
function deployTarget(b: Block, held: SItem | undefined): { kind: string; pos: V3; beltId?: number; entity?: Entity } | undefined {
  const dim = b.dimension;
  const f = facingOf(getStates(b));
  for (const dist of [1, 2]) {
    const p = offset(b.location, f, dist);
    const tb = blockAt(dim, p);
    if (!tb) continue;
    if (tb.typeId === ID('depot')) {
      const main = depotGet(dimKey(dim.id, p)).items[0];
      if (main && findDeploy(main, held)) return { kind: 'depot', pos: p };
      return undefined;
    }
    if (tb.typeId === ID('belt')) {
      const id = beltItemUnder(dim, p, (s) => !!findDeploy(s, held));
      if (id !== undefined) return { kind: 'belt', pos: p, beltId: id };
      return undefined;
    }
    if (dist === 1) {
      // entity in front
      try {
        for (const e of dim.getEntities({ location: { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }, maxDistance: 1 })) {
          if (e.typeId === 'minecraft:item' || e.typeId.startsWith('craftoria:') || e.typeId === 'minecraft:player') continue;
          return { kind: 'attack', pos: p, entity: e };
        }
      } catch {
        /* ignore */
      }
      if (held?.id === 'minecraft:bone_meal' && CROPS.has(tb.typeId)) return { kind: 'bonemeal', pos: p };
      if (held && (tb.isAir || tb.typeId === 'minecraft:air')) {
        try {
          BlockPermutation.resolve(held.id);
          return { kind: 'place', pos: p };
        } catch {
          /* not a block */
        }
      }
      if (!tb.isAir) return undefined;
    }
  }
  return undefined;
}

function deployAct(b: Block, key: string, kind: string, pos: V3, beltId?: number, entity?: Entity): void {
  const dim = b.dimension;
  const d = depStore.get(key) ?? {};
  const held = d.held;
  const useHeld = (n = 1) => {
    if (!d.held) return;
    d.held.n -= n;
    if (d.held.n <= 0) d.held = undefined;
    if (d.held) depStore.set(key, d);
    else depStore.delete(key);
    setHand(key, d.held);
  };
  switch (kind) {
    case 'depot': {
      const db = blockAt(dim, pos);
      const main = depotGet(dimKey(dim.id, pos)).items[0];
      const r = main && findDeploy(main, held);
      if (db && r) {
        depotApplyResult(db, 1, rollOutputs(r.out));
        if (!r.keepHeld) useHeld();
        sound(dim, 'craftoria.deployer', b.center(), 0.5);
      }
      break;
    }
    case 'belt': {
      if (beltId === undefined) break;
      const ok = beltReplaceHeld(dim, pos, beltId, (s) => {
        const r = findDeploy(s, held);
        return r ? { consumed: 1, out: rollOutputs(r.out) } : undefined;
      });
      if (ok) {
        const r = DEPLOYING.find((x) => held && matches(x.held, held));
        if (!r?.keepHeld) useHeld();
        sound(dim, 'craftoria.deployer', b.center(), 0.5);
      }
      beltRelease(dim, pos, beltId);
      break;
    }
    case 'place':
      if (held && tryBlockPlace(dim, pos, held)) {
        useHeld();
        sound(dim, 'craftoria.deployer', b.center(), 0.5);
      }
      break;
    case 'bonemeal':
      if (tryBoneMeal(dim, pos)) useHeld();
      break;
    case 'attack':
      try {
        if (entity?.isValid) entity.applyDamage(weaponDamage(held?.id), { cause: EntityDamageCause.entityAttack });
      } catch {
        /* ignore */
      }
      break;
  }
}

function tickDeployer(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  let st = deployers.get(key);
  if (rpm === 0) {
    if (st?.belt) beltRelease(b.dimension, st.belt.pos, st.belt.id);
    deployers.delete(key);
    const e = rotorAt(key);
    try {
      e?.setProperty(ROTOR_PROPS.p1, 0);
    } catch {
      /* ignore */
    }
    return false;
  }
  if (!st) deployers.set(key, (st = { phase: 'idle', t: 0, len: 20 }));
  const e = rotorAt(key);
  st.t++;
  if (st.phase === 'idle') {
    if (st.t < 4) return true;
    st.t = 0;
    const d = depStore.get(key);
    const tgt = deployTarget(b, d?.held);
    if (!tgt) return true;
    st.len = Math.max(8, Math.min(60, Math.ceil(1600 / Math.abs(rpm))));
    st.phase = 'out';
    (st as DeployerState & { tgt?: typeof tgt }).tgt = tgt;
    if (tgt.kind === 'belt' && tgt.beltId !== undefined) st.belt = { pos: tgt.pos, id: tgt.beltId };
    try {
      e?.setProperty(ROTOR_PROPS.p1, 1);
    } catch {
      /* ignore */
    }
    return true;
  }
  if (st.phase === 'out' && st.t >= st.len / 2) {
    const tgt = (st as DeployerState & { tgt?: { kind: string; pos: V3; beltId?: number; entity?: Entity } }).tgt;
    if (tgt) deployAct(b, key, tgt.kind, tgt.pos, tgt.beltId, tgt.entity);
    st.belt = undefined;
    st.phase = 'back';
    st.t = 0;
    try {
      e?.setProperty(ROTOR_PROPS.p1, 0);
    } catch {
      /* ignore */
    }
    return true;
  }
  if (st.phase === 'back' && st.t >= st.len / 2) {
    st.phase = 'idle';
    st.t = 0;
  }
  return true;
}

registerMachine(DEPLOYER, {
  onInteract(b: Block, p: Player): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const d = depStore.get(key) ?? {};
    const held = heldItem(p);
    if (held && held.typeId === ID('wrench')) return false;
    if (d.held) {
      giveItem(p, d.held);
      d.held = undefined;
    }
    if (held && !p.isSneaking) {
      const s = toS(held);
      d.held = s;
      consumeHeld(p, s.n);
    }
    if (d.held) depStore.set(key, d);
    else depStore.delete(key);
    setHand(key, d.held);
    sound(b.dimension, 'craftoria.item_pop', b.center(), 0.4);
    return true;
  },
  onBreak(dim, pos) {
    const key = dimKey(dim, pos);
    const d = depStore.get(key);
    if (d?.held) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, d.held);
    depStore.delete(key);
    deployers.delete(key);
  },
});

registerBeltProcessor((dim, seg, item) => {
  for (const dist of [1, 2]) {
    const db = blockAt(dim, offset(seg, 'up', dist));
    if (!db || db.typeId !== DEPLOYER) continue;
    if (facingOf(getStates(db)) !== 'down' || speedOf(dim.id, db.location) === 0) return false;
    const held = depStore.get(dimKey(dim.id, db.location))?.held;
    return !!findDeploy(item, held);
  }
  return false;
});

// ------------------------------------------------------------------ encased fan
const FAN = ID('encased_fan');
type FanMode = 'none' | 'wash' | 'smelt';
const fanProgress = new Map<string, number>(); // entity id / belt item key -> ticks

function catalystOf(id: string): FanMode {
  if (id === 'minecraft:water' || id === 'minecraft:flowing_water') return 'wash';
  if (id === 'minecraft:lava' || id === 'minecraft:flowing_lava' || id === 'minecraft:fire' || id === 'minecraft:campfire' || id === 'minecraft:magma') return 'smelt';
  return 'none';
}

function tickFan(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  if (rpm === 0) return false;
  if (now() % 2 !== 0) return true;
  const dim = b.dimension;
  const f = facingOf(getStates(b));
  const push = rpm * DIR_SIGN[f] > 0;
  const range = Math.max(3, Math.min(20, Math.floor(Math.abs(rpm) / 12)));
  const v = DIR_VEC[f];
  let mode: FanMode = 'none';
  let catalystAt = -1;
  let length = range;
  for (let i = 1; i <= range; i++) {
    const p = offset(b.location, f, i);
    const tb = blockAt(dim, p);
    if (!tb) {
      length = i - 1;
      break;
    }
    const c = catalystOf(tb.typeId);
    if (c !== 'none' && catalystAt < 0 && i <= 3) {
      mode = c;
      catalystAt = i;
      continue;
    }
    if (!(tb.isAir || tb.typeId === 'minecraft:air') && tb.typeId !== ID('belt') && tb.typeId !== ID('depot')) {
      length = i - 1;
      break;
    }
  }
  if (length <= 0) return true;
  const c0 = { x: b.location.x + 0.5 + v.x * (length / 2 + 0.5), y: b.location.y + 0.5 + v.y * (length / 2 + 0.5), z: b.location.z + 0.5 + v.z * (length / 2 + 0.5) };
  const strength = (Math.min(256, Math.abs(rpm)) / 256) * 0.09 + 0.02;
  let ents: Entity[] = [];
  try {
    ents = dim.getEntities({ location: c0, maxDistance: length / 2 + 1 });
  } catch {
    /* ignore */
  }
  const lo = b.location;
  for (const e of ents) {
    try {
      if (e.typeId.startsWith('craftoria:')) continue;
      const l = e.location;
      const rel = { x: l.x - (lo.x + 0.5), y: l.y - lo.y, z: l.z - (lo.z + 0.5) };
      const along = rel.x * v.x + rel.y * v.y + rel.z * v.z;
      const perp2 = rel.x * rel.x + (v.y ? 0 : (rel.y - 0.5) * (rel.y - 0.5)) + rel.z * rel.z - along * along;
      if (along < 0 || along > length + 0.5 || perp2 > 0.8) continue;
      const k = (push ? 1 : -1) * strength * (1 - along / (length + 1));
      if (e.typeId === 'minecraft:player') {
        if (!v.y) e.applyKnockback({ x: v.x * k * 6, z: v.z * k * 6 }, 0);
        else if (push && v.y > 0) e.applyKnockback({ x: 0, z: 0 }, Math.max(0.05, k * 4));
      } else e.applyImpulse({ x: v.x * k, y: v.y * k + (v.y ? 0 : 0.003), z: v.z * k });
      // processing beyond the catalyst
      if (mode !== 'none' && e.typeId === 'minecraft:item' && along >= catalystAt - 0.5) {
        const ticks = (fanProgress.get(e.id) ?? 0) + 2;
        fanProgress.set(e.id, ticks);
        const st = e.getComponent('minecraft:item')?.itemStack;
        if (!st) continue;
        const s = toS(st);
        const r = findItemRecipe(mode === 'wash' ? WASHING : SMELTING, s);
        if (!r) continue;
        if (now() % 10 === 0) particles(dim, mode === 'wash' ? 'minecraft:water_splash_particle' : 'minecraft:basic_flame_particle', l, 2, 0.3);
        if (ticks >= r.time) {
          fanProgress.delete(e.id);
          const loc = { ...l };
          e.remove();
          for (let n = 0; n < s.n; n++) for (const o of rollOutputs(r.out)) dropItem(dim, loc, o);
        }
      }
    } catch (err) {
      logError('fan entity', err);
    }
  }
  // belt items inside the stream
  if (mode !== 'none') {
    for (let i = Math.max(1, catalystAt); i <= length + 1; i++) {
      const p = offset(b.location, f, i);
      const below = offset(p, 'down');
      const bb = blockAt(dim, below);
      if (!bb || bb.typeId !== ID('belt')) continue;
      const info = beltOf(dim, below);
      if (!info) continue;
      const id = beltItemUnder(dim, below, (s) => !!findItemRecipe(mode === 'wash' ? WASHING : SMELTING, s));
      if (id === undefined) continue;
      const pk = `${info.key}#${id}`;
      const ticks = (fanProgress.get(pk) ?? 0) + 2;
      fanProgress.set(pk, ticks);
      if (ticks >= 150) {
        fanProgress.delete(pk);
        beltReplaceHeld(dim, below, id, (s) => {
          const r = findItemRecipe(mode === 'wash' ? WASHING : SMELTING, s);
          if (!r) return undefined;
          const out: SItem[] = [];
          for (let n = 0; n < s.n; n++) for (const o of rollOutputs(r.out)) out.push(o);
          return { consumed: s.n, out };
        });
      }
      beltRelease(dim, below, id);
    }
  }
  if (now() % 40 === 0) sound(dim, 'craftoria.fan', b.center(), 0.3, 0.8 + Math.abs(rpm) / 512);
  if (now() % 6 === 0) particles(dim, 'minecraft:basic_smoke_particle', { x: lo.x + 0.5 + v.x * 1.2, y: lo.y + 0.5 + v.y * 1.2, z: lo.z + 0.5 + v.z * 1.2 }, 1, 0.5);
  return true;
}

onSpeedChange((dim, node, _a, nb) => {
  if (nb === 0) return;
  const key = dimKey(dim, node.pos);
  if (node.typeId === DEPLOYER) activate('deployer', key);
  else if (node.typeId === FAN) activate('fan', key);
});

export function tickDeployersAndFans(): void {
  tickActive('deployer', DEPLOYER, tickDeployer);
  tickActive('fan', FAN, tickFan);
}

export function deployerHeld(key: string): SItem | undefined {
  return depStore.get(key)?.held;
}

export { copy, fromS };
