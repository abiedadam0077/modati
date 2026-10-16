// Rotation sources: hand crank, creative motor, water wheel, windmill bearing.
// Output values follow Create defaults (MIT): crank 32 RPM x 8 SU, water wheel 8 RPM x 32 SU,
// windmill clamp(sails/8, 1, 16) RPM x 512 SU, creative motor configurable x 16384 SU.
import { Block, Dimension, Player } from '@minecraft/server';
import { DIR_AXIS, DIR_SIGN, DIR_VEC, Dir, V3, axisUnit, cross, dimKey, offset, perpendicularDirs, AXIS_DIRS } from '../util/vec';
import { blockAt, getStates, now, playSound } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, axisOf, facingOf } from './defs';
import { markGeneratorDirty, setGeneratorProvider } from './network';
import type { CompNode } from './graph';
import type { GeneratorInput } from './types';

export const CRANK_SPEED = 32;
export const CRANK_TICKS = 24;
export const WATER_WHEEL_MAX = 8;

const crank = new Map<string, { until: number; sign: number }>();
const water = new Map<string, number>();
const windmill = new Map<string, number>();
export const motorStore = new BlockStore<{ speed: number }>('mot');

export const MOTOR_STEPS = [-256, -128, -96, -64, -48, -32, -24, -16, -8, -4, -1, 1, 4, 8, 16, 24, 32, 48, 64, 96, 128, 256];

export function motorSpeed(key: string): number {
  return motorStore.get(key)?.speed ?? 16;
}

export function setMotorSpeed(dim: string, pos: V3, speed: number): void {
  motorStore.set(dimKey(dim, pos), { speed });
  markGeneratorDirty(dim, pos);
}

export function turnCrank(block: Block, player: Player | undefined): void {
  const key = dimKey(block.dimension.id, block.location);
  const sign = player?.isSneaking ? -1 : 1;
  const prev = crank.get(key);
  const active = prev && prev.until > now();
  crank.set(key, { until: now() + CRANK_TICKS, sign });
  if (!active || prev!.sign !== sign) markGeneratorDirty(block.dimension.id, block.location);
  playSound(block.dimension, 'craftoria.crank', block.center(), 0.6, 0.9 + Math.random() * 0.2);
  // hunger cost like Create: exhaustion proportional to speed
  try {
    if (player) {
      const ex = player.getComponent('minecraft:player.exhaustion');
      if (ex) ex.setCurrentValue(Math.min(ex.effectiveMax, ex.currentValue + CRANK_SPEED * 0.01));
    }
  } catch {
    /* component may be unavailable */
  }
}

/** Called every few ticks: expire cranks. */
export function tickCranks(): void {
  const t = now();
  for (const [k, v] of crank) {
    if (v.until <= t) {
      crank.delete(k);
      const i = k.indexOf('|');
      const [x, y, z] = k.slice(i + 1).split(',').map(Number);
      markGeneratorDirty(k.slice(0, i), { x, y, z });
    }
  }
}

export function setWindmillSpeed(dim: string, pos: V3, rpm: number): void {
  const key = dimKey(dim, pos);
  const prev = windmill.get(key) ?? 0;
  if (rpm === 0) windmill.delete(key);
  else windmill.set(key, rpm);
  if (prev !== rpm) markGeneratorDirty(dim, pos);
}
export function windmillSpeed(dim: string, pos: V3): number {
  return windmill.get(dimKey(dim, pos)) ?? 0;
}

// ---------------------------------------------------------------------------
// Water flow

const WATER = new Set(['minecraft:water', 'minecraft:flowing_water']);

function depthAt(dim: Dimension, p: V3): number | undefined {
  const b = blockAt(dim, p);
  if (!b) return undefined;
  if (!WATER.has(b.typeId)) {
    // waterlogged blocks count as still water
    return undefined;
  }
  const d = b.permutation.getState('liquid_depth' as never) as unknown as number | undefined;
  return typeof d === 'number' ? d : 0;
}

/** Approximate flow vector of water at p (Bedrock exposes liquid_depth: 0 source, 1-7 flowing, >=8 falling). */
export function flowAt(dim: Dimension, p: V3): V3 {
  const d = depthAt(dim, p);
  if (d === undefined) return { x: 0, y: 0, z: 0 };
  if (d >= 8) return { x: 0, y: -1, z: 0 };
  const f = { x: 0, y: 0, z: 0 };
  for (const dir of ['north', 'south', 'west', 'east'] as Dir[]) {
    const n = offset(p, dir);
    const nd = depthAt(dim, n);
    const v = DIR_VEC[dir];
    if (nd === undefined) {
      const nb = blockAt(dim, n);
      if (nb && (nb.isAir || nb.typeId === 'minecraft:air')) {
        // water flows towards open space only if it can drop below
        const below = blockAt(dim, offset(n, 'down'));
        if (below && (below.isAir || WATER.has(below.typeId))) {
          f.x += v.x * 2;
          f.z += v.z * 2;
        }
      }
      continue;
    }
    const nlevel = nd >= 8 ? 0 : nd;
    const diff = nlevel - d; // positive: neighbour further from source -> flow towards it
    f.x += v.x * diff;
    f.z += v.z * diff;
  }
  const l = Math.hypot(f.x, f.z);
  if (l < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: f.x / l, y: 0, z: f.z / l };
}

/**
 * Flow score of a water wheel: sum over the 4 rim neighbours of flow . tangent, where tangent is the
 * rim velocity direction for positive rotation about +axis: t = axis x d.
 */
export function waterWheelScore(dim: Dimension, pos: V3, axis: 'x' | 'y' | 'z'): number {
  let score = 0;
  const au = axisUnit(axis);
  for (const d of perpendicularDirs(axis)) {
    const p = offset(pos, d);
    const f = flowAt(dim, p);
    if (f.x === 0 && f.y === 0 && f.z === 0) continue;
    const t = cross(au, DIR_VEC[d]);
    score += f.x * t.x + f.y * t.y + f.z * t.z;
  }
  return score;
}

export function updateWaterWheel(block: Block): void {
  const dim = block.dimension;
  const axis = axisOf(getStates(block));
  const s = waterWheelScore(dim, block.location, axis);
  const rpm = Math.round(Math.max(-1, Math.min(1, s)) * WATER_WHEEL_MAX);
  const key = dimKey(dim.id, block.location);
  const prev = water.get(key) ?? 0;
  if (rpm !== prev) {
    if (rpm === 0) water.delete(key);
    else water.set(key, rpm);
    markGeneratorDirty(dim.id, block.location);
  }
}

export function waterWheelSpeed(dim: string, pos: V3): number {
  return water.get(dimKey(dim, pos)) ?? 0;
}

// ---------------------------------------------------------------------------

function provider(dim: Dimension, node: CompNode): GeneratorInput | undefined {
  const key = dimKey(dim.id, node.pos);
  switch (node.typeId) {
    case ID('hand_crank'): {
      const c = crank.get(key);
      if (!c || c.until <= now()) return undefined;
      const b = blockAt(dim, node.pos);
      if (!b) return undefined;
      const f = facingOf(getStates(b));
      return { speed: CRANK_SPEED * c.sign * DIR_SIGN[f], capacity: node.spec.capacity };
    }
    case ID('creative_motor'): {
      const b = blockAt(dim, node.pos);
      if (!b) return undefined;
      const f = facingOf(getStates(b));
      return { speed: motorSpeed(key) * DIR_SIGN[f], capacity: node.spec.capacity };
    }
    case ID('water_wheel'): {
      const s = water.get(key) ?? 0;
      return s ? { speed: s, capacity: node.spec.capacity } : undefined;
    }
    case ID('windmill_bearing'): {
      const s = windmill.get(key) ?? 0;
      if (!s) return undefined;
      const b = blockAt(dim, node.pos);
      if (!b) return undefined;
      const f = facingOf(getStates(b));
      return { speed: s * DIR_SIGN[f], capacity: node.spec.capacity };
    }
  }
  return undefined;
}

export function initGenerators(): void {
  setGeneratorProvider(provider);
}

export { DIR_AXIS, AXIS_DIRS };
