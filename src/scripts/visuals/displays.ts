// Item display entities (items lying on depots / belts / basins, held by arms).
// Displays are purely visual and re-created from machine data; orphans are removed on load.
import { Dimension, Entity, world } from '@minecraft/server';
import { V3 } from '../util/vec';
import { entityValid, logError, players } from '../core/env';

export const ITEM_DISPLAY = 'craftoria:item_display';
const MAX_DISPLAYS = 600;

interface Disp {
  e: Entity;
  item: string;
  loc: V3;
  touched: number;
}
const displays = new Map<string, Disp>();
let tick = 0;

export function displayCount(): number {
  return displays.size;
}

export function nearAnyPlayer(dimId: string, p: V3, r: number): boolean {
  for (const pl of players()) {
    try {
      if (pl.dimension.id !== dimId) continue;
      const l = pl.location;
      const dx = l.x - p.x, dy = l.y - p.y, dz = l.z - p.z;
      if (dx * dx + dy * dy + dz * dz <= r * r) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function setHeldItem(e: Entity, id: string): void {
  try {
    e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${id} 1`);
  } catch (err) {
    logError(`display item ${id}`, err);
  }
}

/**
 * Show `itemId` at world location `loc` (feet position of the display). Pass itemId undefined to hide.
 * scale/mode map to entity properties (mode 0 static, 1 slowly spinning, 2 flat).
 */
export function showItem(key: string, dim: Dimension, loc: V3, itemId: string | undefined, scale = 0.6, mode = 0): void {
  const cur = displays.get(key);
  if (!itemId) {
    if (cur) hideItem(key);
    return;
  }
  if (cur && entityValid(cur.e)) {
    cur.touched = tick;
    const dx = cur.loc.x - loc.x, dy = cur.loc.y - loc.y, dz = cur.loc.z - loc.z;
    if (dx * dx + dy * dy + dz * dz > 0.0004) {
      try {
        cur.e.teleport(loc, { keepVelocity: false });
        cur.loc = { ...loc };
      } catch {
        /* ignore */
      }
    }
    if (cur.item !== itemId) {
      setHeldItem(cur.e, itemId);
      cur.item = itemId;
    }
    return;
  }
  if (displays.size >= MAX_DISPLAYS) return;
  try {
    const e = dim.spawnEntity(ITEM_DISPLAY, loc, { initialRotation: 0 });
    e.setDynamicProperty('cr:dk', key);
    try {
      e.setProperty('craftoria:scale', scale);
      e.setProperty('craftoria:mode', mode);
    } catch {
      /* ignore */
    }
    setHeldItem(e, itemId);
    displays.set(key, { e, item: itemId, loc: { ...loc }, touched: tick });
  } catch (err) {
    logError('spawn display', err);
  }
}

export function hideItem(key: string): void {
  const d = displays.get(key);
  displays.delete(key);
  if (d) {
    try {
      if (d.e.isValid) d.e.remove();
    } catch {
      /* ignore */
    }
  }
}

export function hidePrefix(prefix: string): void {
  for (const k of [...displays.keys()]) if (k.startsWith(prefix)) hideItem(k);
}

/** Remove displays not refreshed for a while (owner unloaded or gone). */
export function sweepDisplays(): void {
  tick++;
  for (const [k, d] of [...displays]) {
    if (!entityValid(d.e) || tick - d.touched > 6) hideItem(k);
  }
}

export function adoptDisplay(e: Entity): void {
  try {
    const k = e.getDynamicProperty('cr:dk') as string | undefined;
    const cur = k ? displays.get(k) : undefined;
    if (!cur || cur.e.id !== e.id) e.remove();
  } catch {
    /* ignore */
  }
}

export function removeOrphanDisplays(): void {
  for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: ITEM_DISPLAY })) adoptDisplay(e);
    } catch {
      /* ignore */
    }
  }
}
