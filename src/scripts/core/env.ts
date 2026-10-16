// Thin, defensive wrappers around the Script API.
import { Block, BlockPermutation, Dimension, Entity, ItemStack, Player, system, world } from '@minecraft/server';
import { V3, dimKey } from '../util/vec';

export const DIM_IDS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'] as const;

const dimCache = new Map<string, Dimension>();
export function dimension(id: string): Dimension {
  let d = dimCache.get(id);
  if (!d) {
    d = world.getDimension(id);
    dimCache.set(id, d);
  }
  return d;
}

/** Returns the block or undefined when out of world / unloaded / invalid. Never throws. */
export function blockAt(dim: Dimension, pos: V3): Block | undefined {
  try {
    const b = dim.getBlock(pos);
    if (!b || !b.isValid) return undefined;
    return b;
  } catch {
    return undefined;
  }
}

export function isLoaded(dim: Dimension, pos: V3): boolean {
  try {
    return dim.isChunkLoaded(pos);
  } catch {
    return false;
  }
}

export type StateValue = string | number | boolean;

export function getStates(b: Block): Record<string, StateValue> {
  try {
    return b.permutation.getAllStates() as Record<string, StateValue>;
  } catch {
    return {};
  }
}

export function getState<T extends StateValue>(b: Block, name: string): T | undefined {
  try {
    return b.permutation.getState(name as never) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Set a block state if it differs. Returns true when changed. */
export function setState(b: Block, name: string, value: StateValue): boolean {
  try {
    const cur = b.permutation.getState(name as never);
    if (cur === value || cur === undefined) return false;
    b.setPermutation(b.permutation.withState(name as never, value as never));
    return true;
  } catch {
    return false;
  }
}

export function setStates(b: Block, values: Record<string, StateValue>): boolean {
  try {
    let p: BlockPermutation = b.permutation;
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      const cur = p.getState(k as never);
      if (cur === undefined || cur === v) continue;
      p = p.withState(k as never, v as never);
      changed = true;
    }
    if (changed) b.setPermutation(p);
    return changed;
  } catch {
    return false;
  }
}

export function keyOf(b: Block): string {
  return dimKey(b.dimension.id, b.location);
}

export function entityValid(e: Entity | undefined): e is Entity {
  try {
    return !!e && e.isValid;
  } catch {
    return false;
  }
}

export function safeEntity(id: string): Entity | undefined {
  try {
    const e = world.getEntity(id);
    return e && e.isValid ? e : undefined;
  } catch {
    return undefined;
  }
}

export function players(): Player[] {
  try {
    return world.getAllPlayers();
  } catch {
    return [];
  }
}

export function now(): number {
  return system.currentTick;
}

export function playSound(dim: Dimension, id: string, pos: V3, volume = 1, pitch = 1): void {
  try {
    dim.playSound(id, pos, { volume, pitch });
  } catch {
    /* sound missing or unloaded */
  }
}

export function particle(dim: Dimension, id: string, pos: V3): void {
  try {
    dim.spawnParticle(id, pos);
  } catch {
    /* ignore */
  }
}

export function runCmd(dim: Dimension, cmd: string): boolean {
  try {
    const r = dim.runCommand(cmd);
    return r.successCount > 0;
  } catch {
    return false;
  }
}

export function spawnItem(dim: Dimension, item: ItemStack, pos: V3): Entity | undefined {
  try {
    const e = dim.spawnItem(item, pos);
    try {
      e.clearVelocity();
    } catch {
      /* ignore */
    }
    return e;
  } catch {
    return undefined;
  }
}

export function msg(p: Player, text: string): void {
  try {
    p.sendMessage(text);
  } catch {
    /* ignore */
  }
}

export function actionbar(p: Player, text: string): void {
  try {
    p.onScreenDisplay.setActionBar(text);
  } catch {
    /* ignore */
  }
}

let lastErr = 0;
export function logError(where: string, e: unknown): void {
  const t = system.currentTick;
  if (t - lastErr < 100) return;
  lastErr = t;
  console.warn(`[CRAFTORIA] ${where}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
}
