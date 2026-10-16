// Active machine sets: only machines with work (non-zero speed or pending items) are ticked.
import { Block } from '@minecraft/server';
import { parseDimKey, dimKey } from '../util/vec';
import { blockAt, dimension, logError } from '../core/env';

const sets = new Map<string, Set<string>>();

export function activate(kind: string, key: string): void {
  let s = sets.get(kind);
  if (!s) sets.set(kind, (s = new Set()));
  s.add(key);
}
export function deactivate(kind: string, key: string): void {
  sets.get(kind)?.delete(key);
}
export function isActive(kind: string, key: string): boolean {
  return sets.get(kind)?.has(key) ?? false;
}
export function activeCount(): number {
  let n = 0;
  for (const s of sets.values()) n += s.size;
  return n;
}

/**
 * Tick every active machine of `kind` whose block is loaded and still of `typeId`.
 * fn returns false to deactivate.
 */
export function tickActive(kind: string, typeId: string | string[], fn: (b: Block, key: string) => boolean | void): void {
  const s = sets.get(kind);
  if (!s || !s.size) return;
  const ids = Array.isArray(typeId) ? typeId : [typeId];
  for (const key of [...s]) {
    const { dim, pos } = parseDimKey(key);
    const b = blockAt(dimension(dim), pos);
    if (!b) continue; // unloaded: keep, resumes when loaded
    if (!ids.includes(b.typeId)) {
      s.delete(key);
      continue;
    }
    try {
      if (fn(b, key) === false) s.delete(key);
    } catch (e) {
      logError(`machine ${kind}`, e);
    }
  }
}

export function keyOfBlock(b: Block): string {
  return dimKey(b.dimension.id, b.location);
}
