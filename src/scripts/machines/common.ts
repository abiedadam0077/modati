// Shared helpers for machines.
import { Block, Dimension, MolangVariableMap } from '@minecraft/server';
import { DIR_VEC, Dir, V3, offset } from '../util/vec';
import { blockAt, getStates, playSound } from '../core/env';
import { settings } from '../core/settings';
import { speedOf, netOf } from '../kinetics/network';

export function speedAt(b: Block | { dimension: Dimension; location: V3 }, sub = ''): number {
  return speedOf(b.dimension.id, b.location, sub);
}

export function netStatus(b: Block): string {
  return netOf(b.dimension.id, b.location)?.status ?? 'stopped';
}

const HEAT_BLOCKS = new Set(['minecraft:fire', 'minecraft:soul_fire', 'minecraft:lava', 'minecraft:flowing_lava', 'minecraft:magma']);

/** Heat source directly below a basin: fire, lava, magma, lit campfire. */
export function isHeated(dim: Dimension, basinPos: V3): boolean {
  const b = blockAt(dim, offset(basinPos, 'down'));
  if (!b) return false;
  if (HEAT_BLOCKS.has(b.typeId)) return true;
  if (b.typeId === 'minecraft:campfire' || b.typeId === 'minecraft:soul_campfire') {
    const ext = getStates(b)['extinguished'];
    return ext !== true;
  }
  return false;
}

export function sound(dim: Dimension, id: string, pos: V3, vol = 0.6, pitch = 1): void {
  if (!settings.sounds) return;
  playSound(dim, id, pos, vol, pitch);
}

export function particles(dim: Dimension, id: string, pos: V3, count = 1, spread = 0.3): void {
  if (settings.particles <= 0) return;
  const n = settings.particles === 1 ? Math.ceil(count / 3) : count;
  for (let i = 0; i < n; i++) {
    try {
      dim.spawnParticle(id, { x: pos.x + (Math.random() - 0.5) * spread, y: pos.y + (Math.random() - 0.5) * spread, z: pos.z + (Math.random() - 0.5) * spread });
    } catch {
      return;
    }
  }
}

export function coloredDust(dim: Dimension, pos: V3, r: number, g: number, b: number): void {
  if (settings.particles <= 0) return;
  try {
    const m = new MolangVariableMap();
    m.setColorRGBA('variable.color', { red: r, green: g, blue: b, alpha: 1 });
    dim.spawnParticle('minecraft:colored_flame_particle', pos, m);
  } catch {
    /* ignore */
  }
}

/** Machine processing rate multiplier (Create-like): ~1 at 16 RPM, linear in speed. */
export function rateFromSpeed(rpm: number): number {
  return Math.max(0, Math.min(32, Math.abs(rpm) / 16));
}

export function centerOf(p: V3): V3 {
  return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
}

export function faceCenter(p: V3, d: Dir, out = 0.5): V3 {
  const v = DIR_VEC[d];
  return { x: p.x + 0.5 + v.x * out, y: p.y + 0.5 + v.y * out, z: p.z + 0.5 + v.z * out };
}

/** Pitch for machine loops scaled by speed (Create uses 0.85..1 range). */
export function pitchFor(rpm: number): number {
  return Math.max(0.7, Math.min(1.4, 0.8 + Math.abs(rpm) / 256));
}
