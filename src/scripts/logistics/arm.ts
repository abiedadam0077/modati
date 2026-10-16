// Mechanical Arm: picks items from input points and delivers them to output points.
// Configure before placing (Create-style): sneak + use the arm item on blocks to cycle
// Input -> Output -> none, then place the arm within 5 blocks.
import { Block, Dimension, Player, system, world } from '@minecraft/server';
import { V3, dimKey, sub, add, offset } from '../util/vec';
import { blockAt, dimension, msg, particle } from '../core/env';
import { BlockStore } from '../core/store';
import { ID } from '../kinetics/defs';
import { onSpeedChange, speedOf } from '../kinetics/network';
import { SItem, copy } from '../util/items';
import { registerMachine } from '../machines/registry';
import { dropItem, extractAt, hasInventory, insertAt, giveItem } from './transport';
import { activate, tickActive } from '../machines/active';
import { sound } from '../machines/common';
import { rotorAt, ROTOR_PROPS, onRotorConfigured } from '../visuals/rotors';
import { wheelPair } from '../machines/grinders';

const ARM = ID('mechanical_arm');
export const ARM_RANGE = 5;

interface Target {
  o: V3; // offset from the arm
  m: 'i' | 'o';
}
interface ArmData {
  t: Target[];
  held?: SItem;
  rr: number;
}
const armStore = new BlockStore<ArmData>('arm');
const pending = new Map<string, { dim: string; list: { pos: V3; m: 'i' | 'o' }[] }>();

interface ArmRun {
  phase: 'idle' | 'toIn' | 'toOut';
  t: number;
  len: number;
  src?: V3;
  dst?: V3;
  wait: number;
}
const runs = new Map<string, ArmRun>();

// ------------------------------------------------------------------ selection before placing
function isInteractionPoint(dim: Dimension, pos: V3): boolean {
  const b = blockAt(dim, pos);
  if (!b) return false;
  if (b.typeId === ID('crushing_wheel')) return true;
  return hasInventory(dim, pos);
}

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (!ev.itemStack || ev.itemStack.typeId !== ARM || !ev.player.isSneaking) return;
  ev.cancel = true;
  const p = ev.player;
  const pos = { ...ev.block.location };
  const dimId = ev.block.dimension.id;
  system.run(() => {
    const dim = dimension(dimId);
    if (!isInteractionPoint(dim, pos)) {
      msg(p, '§cNot a valid interaction point (containers, depots, belts, basins, millstones, funnels, chutes, crushing wheels).');
      return;
    }
    let pend = pending.get(p.id);
    if (!pend || pend.dim !== dimId) pending.set(p.id, (pend = { dim: dimId, list: [] }));
    const i = pend.list.findIndex((x) => x.pos.x === pos.x && x.pos.y === pos.y && x.pos.z === pos.z);
    if (i < 0) {
      pend.list.push({ pos, m: 'i' });
      msg(p, `§bInput §7selected (${pend.list.length} points). Sneak-use again to make it an output.`);
    } else if (pend.list[i].m === 'i') {
      pend.list[i].m = 'o';
      msg(p, '§6Output §7selected. Sneak-use again to remove.');
    } else {
      pend.list.splice(i, 1);
      msg(p, '§7Point removed.');
    }
    sound(dim, 'craftoria.wrench', { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, 0.5, 1.4);
  });
});

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  if (ev.block.typeId !== ARM) return;
  const p = ev.player;
  const pend = pending.get(p.id);
  const key = dimKey(ev.block.dimension.id, ev.block.location);
  const d: ArmData = { t: [], rr: 0 };
  if (pend && pend.dim === ev.block.dimension.id) {
    for (const s of pend.list) {
      const o = sub(s.pos, ev.block.location);
      if (Math.abs(o.x) <= ARM_RANGE && Math.abs(o.y) <= ARM_RANGE && Math.abs(o.z) <= ARM_RANGE) d.t.push({ o, m: s.m });
    }
    pending.delete(p.id);
  }
  armStore.set(key, d);
  const ins = d.t.filter((x) => x.m === 'i').length, outs = d.t.length - ins;
  msg(p, ins && outs ? `§aMechanical Arm configured: ${ins} input(s), ${outs} output(s).` : '§eMechanical Arm placed without inputs/outputs. Sneak-use the arm item on blocks before placing it.');
});

// ------------------------------------------------------------------ kinematics
/** Arm pose (degrees) to reach a target offset; mirrors the rotor model (lower 14px, upper 13px, claw 6px). */
export function armPose(o: V3, surface = 1): { yaw: number; lower: number; upper: number; head: number } {
  const dx = o.x * 16, dz = o.z * 16;
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  const R = Math.max(2, Math.hypot(dx, dz));
  const targetY = (o.y + surface) * 16 + 6 - 12; // claw sits 6px below the upper arm, lower pivot at 12px
  const L1 = 14, L2 = 13;
  let d = Math.hypot(R, targetY);
  d = Math.min(d, L1 + L2 - 0.01);
  const beta = Math.atan2(targetY, R);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const g1 = beta + alpha;
  const ex = L1 * Math.cos(g1), ey = L1 * Math.sin(g1);
  const g2 = Math.atan2(targetY - ey, R - ex);
  const th1 = 90 - (g1 * 180) / Math.PI;
  const phi = -(g2 * 180) / Math.PI;
  const th2 = phi - th1;
  return { yaw, lower: th1, upper: th2, head: -(th1 + th2) };
}

function surfaceOf(dim: Dimension, pos: V3): number {
  const b = blockAt(dim, pos);
  if (!b) return 1;
  switch (b.typeId) {
    case ID('depot'): return 11 / 16;
    case ID('belt'): return 13 / 16;
    case ID('basin'): return 0.5;
    case ID('andesite_funnel'):
    case ID('brass_funnel'): return 6 / 16;
    default: return 1;
  }
}

function setPose(key: string, dim: Dimension, armPos: V3, target: V3 | undefined): void {
  const e = rotorAt(key);
  if (!e) return;
  const pose = target ? armPose(sub(target, armPos), surfaceOf(dim, target)) : { yaw: 0, lower: 0, upper: 0, head: 0 };
  try {
    e.setProperty(ROTOR_PROPS.p1, Math.round(pose.yaw * 10) / 10);
    e.setProperty(ROTOR_PROPS.p2, Math.round(pose.lower * 10) / 10);
    e.setProperty(ROTOR_PROPS.p3, Math.round(pose.upper * 10) / 10);
    e.setProperty(ROTOR_PROPS.p4, Math.round(pose.head * 10) / 10);
  } catch {
    /* ignore */
  }
}

function setClaw(key: string, item: SItem | undefined): void {
  const e = rotorAt(key);
  if (!e) return;
  try {
    e.runCommand(item ? `replaceitem entity @s slot.weapon.mainhand 0 ${item.id} 1` : 'replaceitem entity @s slot.weapon.mainhand 0 air');
  } catch {
    /* ignore */
  }
}

onRotorConfigured((key, _e, _st, typeId) => {
  if (typeId !== ARM) return;
  setClaw(key, armStore.get(key)?.held);
});

// ------------------------------------------------------------------ transfer
function insertTarget(dim: Dimension, pos: V3, item: SItem, simulate: boolean): number {
  const b = blockAt(dim, pos);
  if (!b) return 0;
  if (b.typeId === ID('crushing_wheel')) {
    const pair = wheelPair(dim, pos);
    if (!pair) return 0;
    if (!simulate) dropItem(dim, { x: pair.gap.x + 0.5, y: pair.gap.y + 1.2, z: pair.gap.z + 0.5 }, item);
    return item.n;
  }
  return insertAt(dim, pos, item, 'up', simulate);
}

function tickArm(b: Block, key: string): boolean {
  const rpm = speedOf(b.dimension.id, b.location);
  if (rpm === 0) {
    runs.delete(key);
    return false;
  }
  const d = armStore.get(key);
  if (!d || !d.t.length) return true;
  const dim = b.dimension;
  let run = runs.get(key);
  if (!run) runs.set(key, (run = { phase: 'idle', t: 0, len: 10, wait: 0 }));
  const moveTicks = Math.max(6, Math.min(60, Math.ceil(600 / Math.abs(rpm))));
  const inputs = d.t.filter((x) => x.m === 'i').map((x) => add(b.location, x.o));
  const outputs = d.t.filter((x) => x.m === 'o').map((x) => add(b.location, x.o));
  if (run.wait > 0) {
    run.wait--;
    return true;
  }
  if (run.phase === 'idle') {
    if (d.held) {
      // deliver what we hold
      const dst = outputs.find((o) => insertTarget(dim, o, d.held!, true) > 0);
      if (!dst) {
        run.wait = 20;
        return true;
      }
      run.phase = 'toOut';
      run.dst = dst;
      run.t = 0;
      run.len = moveTicks;
      setPose(key, dim, b.location, dst);
      sound(dim, 'craftoria.arm', b.center(), 0.35, 0.9 + Math.random() * 0.2);
      return true;
    }
    // find an input with an item some output accepts
    for (let k = 0; k < inputs.length; k++) {
      const src = inputs[(d.rr + k) % inputs.length];
      const peek = extractAt(dim, src, (s) => outputs.some((o) => insertTarget(dim, o, copy(s, 1), true) > 0), 64, 'up', true);
      if (!peek) continue;
      d.rr = (d.rr + k + 1) % Math.max(1, inputs.length);
      run.phase = 'toIn';
      run.src = src;
      run.t = 0;
      run.len = moveTicks;
      setPose(key, dim, b.location, src);
      sound(dim, 'craftoria.arm', b.center(), 0.35, 0.9 + Math.random() * 0.2);
      return true;
    }
    run.wait = 10;
    setPose(key, dim, b.location, undefined);
    return true;
  }
  run.t++;
  if (run.t < run.len) return true;
  if (run.phase === 'toIn' && run.src) {
    const got = extractAt(dim, run.src, (s) => outputs.some((o) => insertTarget(dim, o, copy(s, 1), true) > 0), 16, 'up');
    if (got) {
      d.held = got;
      armStore.set(key, d);
      setClaw(key, got);
    }
    run.phase = 'idle';
    return true;
  }
  if (run.phase === 'toOut' && run.dst && d.held) {
    const n = insertTarget(dim, run.dst, d.held, false);
    if (n > 0) {
      d.held.n -= n;
      if (d.held.n <= 0) d.held = undefined;
      armStore.set(key, d);
      setClaw(key, d.held);
      particle(dim, 'minecraft:basic_crit_particle', { x: run.dst.x + 0.5, y: run.dst.y + 1, z: run.dst.z + 0.5 });
    }
    run.phase = 'idle';
  }
  return true;
}

registerMachine(ARM, {
  onInteract(b: Block, p: Player): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const d = armStore.get(key);
    if (p.isSneaking && d) {
      if (d.held) giveItem(p, d.held);
      armStore.set(key, { t: [], rr: 0 });
      setClaw(key, undefined);
      msg(p, '§eArm targets cleared. Break and re-place the arm to configure new points.');
      return true;
    }
    if (d) {
      const ins = d.t.filter((x) => x.m === 'i').length;
      msg(p, `§7Mechanical Arm: §b${ins} input(s)§7, §6${d.t.length - ins} output(s)§7. Speed ${speedOf(b.dimension.id, b.location).toFixed(1)} RPM.`);
      return true;
    }
    return false;
  },
  onBreak(dim, pos) {
    const key = dimKey(dim, pos);
    const d = armStore.get(key);
    if (d?.held) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 1, z: pos.z + 0.5 }, d.held);
    armStore.delete(key);
    runs.delete(key);
  },
});

onSpeedChange((dim, node, _a, nb) => {
  if (nb !== 0 && node.typeId === ARM) activate('arm', dimKey(dim, node.pos));
});

export function tickArms(): void {
  tickActive('arm', ARM, tickArm);
}

export function armInfo(key: string): ArmData | undefined {
  return armStore.get(key);
}
export { offset };
