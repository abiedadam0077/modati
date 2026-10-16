// Mechanical Press (pressing on depot / belt / ground, compacting in basin) and Mechanical Mixer.
// Press cycle timing ported from Create's PressingBehaviour (MIT):
//   running ticks per tick = lerp(clamp(|speed|/512, 0, 1), 1, 60), cycle = 240.
import { Block, Dimension, Entity } from '@minecraft/server';
import { V3, dimKey, offset } from '../util/vec';
import { blockAt } from '../core/env';
import { ID } from '../kinetics/defs';
import { onSpeedChange } from '../kinetics/network';
import { SItem, toS, fromS, mergeInto } from '../util/items';
import { COMPACTING, MIXING, PRESSING, consumeBasin, findBasinRecipe, findItemRecipe, rollOutputs } from '../recipes/processing';
import { activate, tickActive } from './active';
import { BASIN_SLOTS, addFluid, basinGet, basinSet, depotApplyResult, depotGet } from './depot_basin';
import { isHeated, particles, sound, speedAt } from './common';
import { rotorAt, ROTOR_PROPS } from '../visuals/rotors';
import { beltItemUnder, beltReplaceHeld, beltRelease, registerBeltProcessor } from '../logistics/belt_api';
import { dropItem } from '../logistics/transport';

type Target =
  | { kind: 'depot'; pos: V3 }
  | { kind: 'basin'; pos: V3 }
  | { kind: 'belt'; pos: V3; itemId: number }
  | { kind: 'world'; entity: Entity };

interface PressState {
  t: number;
  len: number;
  target?: Target;
  acted: boolean;
  scanCooldown: number;
}
const presses = new Map<string, PressState>();

export function pressCycleTicks(rpm: number): number {
  const s = Math.min(1, Math.abs(rpm) / 512);
  const perTick = Math.floor(1 + (60 - 1) * s);
  return Math.max(6, Math.ceil(240 / perTick));
}

const TRAVEL = { world: 1, belt: 19 / 16, depot: 21 / 16, basin: 22 / 16 } as const;

function setProp(key: string, id: string, v: number): Entity | undefined {
  const e = rotorAt(key);
  if (!e) return undefined;
  try {
    if (e.getProperty(id) !== v) e.setProperty(id, v);
  } catch {
    /* ignore */
  }
  return e;
}

function findPressTarget(b: Block): Target | undefined {
  const dim = b.dimension;
  const below2 = offset(b.location, 'down', 2);
  const tb = blockAt(dim, below2);
  if (tb) {
    if (tb.typeId === ID('basin')) {
      const d = basinGet(dimKey(dim.id, below2));
      const r = findBasinRecipe(COMPACTING, d, false);
      if (r && d.out.length < BASIN_SLOTS) return { kind: 'basin', pos: below2 };
      return undefined;
    }
    if (tb.typeId === ID('depot')) {
      const d = depotGet(dimKey(dim.id, below2));
      const main = d.items[0];
      if (main && findItemRecipe(PRESSING, main)) return { kind: 'depot', pos: below2 };
      return undefined;
    }
    if (tb.typeId === ID('belt')) {
      const it = beltItemUnder(dim, below2, (s) => !!findItemRecipe(PRESSING, s));
      if (it !== undefined) return { kind: 'belt', pos: below2, itemId: it };
      return undefined;
    }
  }
  // world: item entities lying in the block below the press
  const below1 = offset(b.location, 'down');
  const ab = blockAt(dim, below1);
  if (ab && !ab.isAir) return undefined;
  try {
    for (const e of dim.getEntities({ type: 'minecraft:item', location: { x: below1.x + 0.5, y: below1.y + 0.3, z: below1.z + 0.5 }, maxDistance: 0.8 })) {
      const st = e.getComponent('minecraft:item')?.itemStack;
      if (st && findItemRecipe(PRESSING, toS(st))) return { kind: 'world', entity: e };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function pressAct(b: Block, t: Target): boolean {
  const dim = b.dimension;
  switch (t.kind) {
    case 'depot': {
      const db = blockAt(dim, t.pos);
      const d = depotGet(dimKey(dim.id, t.pos));
      const main = d.items[0];
      const r = main && findItemRecipe(PRESSING, main);
      if (!db || !r) return false;
      depotApplyResult(db, r.in.n ?? 1, rollOutputs(r.out));
      return true;
    }
    case 'basin': {
      const bb = blockAt(dim, t.pos);
      const d = basinGet(dimKey(dim.id, t.pos));
      const r = findBasinRecipe(COMPACTING, d, false);
      if (!bb || !r) return false;
      consumeBasin(r, d);
      for (const o of rollOutputs(r.out)) mergeInto(d.out, o, BASIN_SLOTS);
      basinSet(bb, d);
      return true;
    }
    case 'belt': {
      const results = beltReplaceHeld(dim, t.pos, t.itemId, (s) => {
        const r = findItemRecipe(PRESSING, s);
        return r ? { consumed: r.in.n ?? 1, out: rollOutputs(r.out) } : undefined;
      });
      return results;
    }
    case 'world': {
      try {
        if (!t.entity.isValid) return false;
        const comp = t.entity.getComponent('minecraft:item');
        const st = comp?.itemStack;
        if (!st) return false;
        const s = toS(st);
        const r = findItemRecipe(PRESSING, s);
        if (!r) return false;
        const loc = t.entity.location;
        const n = r.in.n ?? 1;
        if (s.n <= n) t.entity.remove();
        else {
          s.n -= n;
          const ns = fromS(s);
          t.entity.remove();
          if (ns) dropItem(dim, loc, toS(ns));
        }
        for (const o of rollOutputs(r.out)) dropItem(dim, loc, o);
        return true;
      } catch {
        return false;
      }
    }
  }
}

function tickPress(b: Block, key: string): boolean {
  const rpm = speedAt(b);
  let st = presses.get(key);
  if (rpm === 0) {
    if (st?.target?.kind === 'belt') beltRelease(b.dimension, st.target.pos, st.target.itemId);
    presses.delete(key);
    return false;
  }
  if (!st) presses.set(key, (st = { t: 0, len: 0, acted: false, scanCooldown: 0 }));
  if (!st.target) {
    if (st.scanCooldown-- > 0) return true;
    st.scanCooldown = 4;
    const target = findPressTarget(b);
    if (!target) return true;
    st.target = target;
    st.t = 0;
    st.len = pressCycleTicks(rpm);
    st.acted = false;
    const e = setProp(key, ROTOR_PROPS.p1, TRAVEL[target.kind]);
    setProp(key, ROTOR_PROPS.rate, Math.min(100, 20 / st.len));
    try {
      e?.playAnimation('animation.craftoria.rotor.press_cycle', { blendOutTime: 0 });
    } catch {
      /* ignore */
    }
    return true;
  }
  st.t++;
  if (!st.acted && st.t >= Math.floor(st.len / 2)) {
    st.acted = true;
    const ok = pressAct(b, st.target);
    if (ok) {
      const p = b.location;
      const y = st.target.kind === 'world' ? p.y - 0.9 : p.y - 1.2;
      sound(b.dimension, 'craftoria.press', { x: p.x + 0.5, y, z: p.z + 0.5 }, 0.7, 0.9 + Math.random() * 0.2);
      particles(b.dimension, 'minecraft:basic_crit_particle', { x: p.x + 0.5, y, z: p.z + 0.5 }, 6, 0.6);
    }
  }
  if (st.t >= st.len) {
    if (st.target.kind === 'belt') beltRelease(b.dimension, st.target.pos, st.target.itemId);
    st.target = undefined;
    st.scanCooldown = 0;
  }
  return true;
}

// ------------------------------------------------------------------ mixer
interface MixState {
  t: number;
  len: number;
  recipeIndex: number;
  idleTicks: number;
}
const mixers = new Map<string, MixState>();
const mixCooldown = new Map<string, number>();
export const MIXER_MIN_SPEED = 30;

function tickMixer(b: Block, key: string): boolean {
  const rpm = speedAt(b);
  const dim = b.dimension;
  if (rpm === 0) {
    mixers.delete(key);
    setProp(key, ROTOR_PROPS.p1, 0);
    return false;
  }
  const basinPos = offset(b.location, 'down', 2);
  const bb = blockAt(dim, basinPos);
  let st = mixers.get(key);
  if (!bb || bb.typeId !== ID('basin') || Math.abs(rpm) < MIXER_MIN_SPEED) {
    mixers.delete(key);
    setProp(key, ROTOR_PROPS.p1, 0);
    return true;
  }
  const bkey = dimKey(dim.id, basinPos);
  const d = basinGet(bkey);
  const heated = isHeated(dim, basinPos);
  if (!st) {
    const cd = mixCooldown.get(key) ?? 0;
    if (cd > 0) {
      mixCooldown.set(key, cd - 1);
      return true;
    }
    mixCooldown.set(key, 5);
    const r = findBasinRecipe(MIXING, d, heated);
    if (!r || d.out.length >= BASIN_SLOTS) {
      setProp(key, ROTOR_PROPS.p1, 0);
      return true;
    }
    const len = Math.max(20, Math.min(600, Math.ceil((r.time * 32) / Math.abs(rpm))));
    st = { t: 0, len, recipeIndex: MIXING.indexOf(r), idleTicks: 0 };
    mixers.set(key, st);
    setProp(key, ROTOR_PROPS.p1, 1);
    setProp(key, ROTOR_PROPS.p2, Math.max(-1024, Math.min(1024, rpm * 2.5)));
  }
  st.t++;
  const p = basinPos;
  if (st.t % 20 === 0) {
    sound(dim, 'craftoria.mixer', { x: p.x + 0.5, y: p.y + 0.6, z: p.z + 0.5 }, 0.5, 0.9 + Math.random() * 0.2);
    particles(dim, d.fluids.some((f) => f.f === 'lava') ? 'minecraft:lava_particle' : 'minecraft:water_splash_particle', { x: p.x + 0.5, y: p.y + 0.7, z: p.z + 0.5 }, 3, 0.5);
  }
  if (st.t >= st.len) {
    const r = MIXING[st.recipeIndex];
    const cur = basinGet(bkey);
    if (r && findBasinRecipe([r], cur, heated)) {
      consumeBasin(r, cur);
      for (const o of rollOutputs(r.out)) mergeInto(cur.out, o, BASIN_SLOTS);
      if (r.outFluid) addFluid(cur, r.outFluid.f, r.outFluid.mb);
      basinSet(bb, cur);
      sound(dim, 'craftoria.item_pop', { x: p.x + 0.5, y: p.y + 0.8, z: p.z + 0.5 }, 0.5);
    }
    mixers.delete(key);
    const next = findBasinRecipe(MIXING, basinGet(bkey), heated);
    if (!next) setProp(key, ROTOR_PROPS.p1, 0);
  }
  return true;
}

// ------------------------------------------------------------------ wiring
registerBeltProcessor((dim, seg, item) => {
  const pb = blockAt(dim, offset(seg, 'up', 2));
  return !!pb && pb.typeId === ID('mechanical_press') && speedAt(pb) !== 0 && !!findItemRecipe(PRESSING, item);
});

onSpeedChange((dim, node, _a, b) => {
  if (b === 0) return;
  if (node.typeId === ID('mechanical_press')) activate('press', dimKey(dim, node.pos));
  else if (node.typeId === ID('mechanical_mixer')) activate('mixer', dimKey(dim, node.pos));
});

export function tickPressesAndMixers(): void {
  tickActive('press', ID('mechanical_press'), tickPress);
  tickActive('mixer', ID('mechanical_mixer'), tickMixer);
}

export function pressState(key: string): PressState | undefined {
  return presses.get(key);
}
export function mixerState(key: string): MixState | undefined {
  return mixers.get(key);
}

export type { SItem, Dimension };
