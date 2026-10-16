// Dispatch of block events to machine / logistics handlers by block type.
import { Block, BlockPermutation, Direction, Player } from '@minecraft/server';
import type { V3 } from '../util/vec';

export interface MachineHandler {
  onPlace?(block: Block): void;
  /** block already destroyed; perm = previous permutation */
  onBreak?(dim: string, pos: V3, perm: BlockPermutation): void;
  /** return true when the interaction was consumed */
  onInteract?(block: Block, player: Player, face: Direction): boolean;
  /** block tick (minecraft:tick interval from JSON) */
  onTick?(block: Block): void;
}

const handlers = new Map<string, MachineHandler[]>();

export function registerMachine(typeIds: string | string[], h: MachineHandler): void {
  for (const id of Array.isArray(typeIds) ? typeIds : [typeIds]) {
    let l = handlers.get(id);
    if (!l) handlers.set(id, (l = []));
    l.push(h);
  }
}

export function handlersOf(typeId: string): MachineHandler[] {
  return handlers.get(typeId) ?? [];
}
