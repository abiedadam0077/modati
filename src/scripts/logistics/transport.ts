// Unified item transfer between CRAFTORIA machines, belts, chutes and vanilla containers.
import { Block, Dimension, GameMode, Player, Vector3 } from '@minecraft/server';
import { Dir, V3 } from '../util/vec';
import { blockAt, spawnItem } from '../core/env';
import { SItem, copy, extractFromContainer, fromS, getContainer, insertIntoContainer } from '../util/items';

export interface ItemPort {
  /** insert through `face` of this block; returns amount accepted */
  insert?(b: Block, item: SItem, face: Dir, simulate: boolean): number;
  /** extract through `face` of this block */
  extract?(b: Block, pred: (s: SItem) => boolean, max: number, face: Dir, simulate: boolean): SItem | undefined;
}

const ports = new Map<string, ItemPort>();

export function registerPort(typeIds: string | string[], p: ItemPort): void {
  for (const id of Array.isArray(typeIds) ? typeIds : [typeIds]) ports.set(id, p);
}

export function portOf(typeId: string): ItemPort | undefined {
  return ports.get(typeId);
}

/** Try to insert `item` into the block at pos through its `face`. Returns accepted amount. */
export function insertAt(dim: Dimension, pos: V3, item: SItem, face: Dir, simulate = false): number {
  const b = blockAt(dim, pos);
  if (!b || item.n <= 0) return 0;
  const p = ports.get(b.typeId);
  if (p?.insert) return p.insert(b, item, face, simulate);
  const c = getContainer(b);
  if (c) return insertIntoContainer(b, c, item, face, simulate);
  return 0;
}

export function canInsertAt(dim: Dimension, pos: V3, item: SItem, face: Dir): boolean {
  return insertAt(dim, pos, item, face, true) > 0;
}

export function extractAt(dim: Dimension, pos: V3, pred: (s: SItem) => boolean, max: number, face: Dir, simulate = false): SItem | undefined {
  const b = blockAt(dim, pos);
  if (!b) return undefined;
  const p = ports.get(b.typeId);
  if (p?.extract) return p.extract(b, pred, max, face, simulate);
  const c = getContainer(b);
  if (c) return extractFromContainer(b, c, pred, max, face, simulate);
  return undefined;
}

export function hasInventory(dim: Dimension, pos: V3): boolean {
  const b = blockAt(dim, pos);
  if (!b) return false;
  return ports.has(b.typeId) || !!getContainer(b);
}

/** Drop as a vanilla item entity. */
export function dropItem(dim: Dimension, loc: Vector3, item: SItem): void {
  let left = item.n;
  while (left > 0) {
    const st = fromS(copy(item, left));
    if (!st) return;
    spawnItem(dim, st, loc);
    left -= st.amount;
  }
}

/** Give to the player, dropping the rest at their feet. */
export function giveItem(p: Player, item: SItem): void {
  try {
    const inv = p.getComponent('minecraft:inventory')?.container;
    let left = item.n;
    while (left > 0) {
      const st = fromS(copy(item, left));
      if (!st) return;
      const amount = st.amount;
      const rest = inv?.addItem(st);
      if (rest) {
        spawnItem(p.dimension, rest, p.location);
      }
      left -= amount;
    }
  } catch {
    dropItem(p.dimension, p.location, item);
  }
}

/** Remove `n` items from the player's selected slot (creative players keep items). */
export function consumeHeld(p: Player, n = 1): void {
  try {
    if (p.getGameMode() === GameMode.Creative) return;
    const inv = p.getComponent('minecraft:inventory')?.container;
    if (!inv) return;
    const slot = p.selectedSlotIndex;
    const it = inv.getItem(slot);
    if (!it) return;
    if (it.amount <= n) inv.setItem(slot, undefined);
    else {
      it.amount -= n;
      inv.setItem(slot, it);
    }
  } catch {
    /* ignore */
  }
}

export function heldItem(p: Player) {
  try {
    return p.getComponent('minecraft:inventory')?.container?.getItem(p.selectedSlotIndex);
  } catch {
    return undefined;
  }
}

export function setHeld(p: Player, item: SItem | undefined): void {
  try {
    const inv = p.getComponent('minecraft:inventory')?.container;
    if (!inv) return;
    inv.setItem(p.selectedSlotIndex, item ? fromS(item) : undefined);
  } catch {
    /* ignore */
  }
}
