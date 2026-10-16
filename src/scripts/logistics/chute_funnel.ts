// Chutes (vertical transport), Andesite/Brass Funnels (insert / extract, filters, redstone lock)
// and the Filter item.
import { Block, ItemStack, Player } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { DIR_VEC, Dir, OPPOSITE, V3, dimKey, offset } from '../util/vec';
import { blockAt, dimension, getStates, msg, setState, now } from '../core/env';
import { BlockStore } from '../core/store';
import { ID, facingOf } from '../kinetics/defs';
import { SItem, copy, toS, fromS } from '../util/items';
import { registerMachine } from '../machines/registry';
import { registerPort, dropItem, extractAt, insertAt, heldItem } from './transport';
import { activate, tickActive } from '../machines/active';
import { sound } from '../machines/common';

// ------------------------------------------------------------------ chute
const CHUTE = ID('chute');
interface ChuteData {
  item?: SItem;
  prog: number;
}
const chuteStore = new BlockStore<ChuteData>('chute');

registerPort(CHUTE, {
  insert(b, item, face, simulate) {
    if (face === 'down') return 0;
    const key = dimKey(b.dimension.id, b.location);
    const d = chuteStore.get(key);
    if (d?.item) return 0;
    const n = Math.min(64, item.n);
    if (!simulate) {
      chuteStore.set(key, { item: copy(item, n), prog: 0 });
      activate('chute', key);
    }
    return n;
  },
  extract(b, pred, max, _face, simulate) {
    const key = dimKey(b.dimension.id, b.location);
    const d = chuteStore.get(key);
    if (!d?.item || !pred(d.item)) return undefined;
    const t = Math.min(max, d.item.n);
    const out = copy(d.item, t);
    if (!simulate) {
      d.item.n -= t;
      if (d.item.n <= 0) chuteStore.delete(key);
      else chuteStore.set(key, d);
    }
    return out;
  },
});

function tickChute(b: Block, key: string): boolean {
  const d = chuteStore.get(key);
  if (!d?.item) {
    chuteStore.delete(key);
    return false;
  }
  d.prog += 0.25;
  if (d.prog < 1) {
    chuteStore.set(key, d);
    return true;
  }
  const below = offset(b.location, 'down');
  const bb = blockAt(b.dimension, below);
  if (!bb) return true;
  const n = insertAt(b.dimension, below, d.item, 'up');
  if (n > 0) d.item.n -= n;
  else if (bb.isAir || bb.typeId === 'minecraft:air') {
    dropItem(b.dimension, { x: below.x + 0.5, y: below.y + 0.6, z: below.z + 0.5 }, d.item);
    d.item.n = 0;
  }
  if (d.item.n <= 0) {
    chuteStore.delete(key);
    return false;
  }
  d.prog = 1;
  chuteStore.set(key, d);
  return true;
}

registerMachine(CHUTE, {
  onTick(b) {
    const key = dimKey(b.dimension.id, b.location);
    // items falling into the top of the chute
    try {
      if (!chuteStore.get(key)?.item) {
        for (const e of b.dimension.getEntities({ type: 'minecraft:item', location: { x: b.location.x + 0.5, y: b.location.y + 0.9, z: b.location.z + 0.5 }, maxDistance: 0.6 })) {
          const st = e.getComponent('minecraft:item')?.itemStack;
          if (!st) continue;
          chuteStore.set(key, { item: toS(st), prog: 0 });
          e.remove();
          break;
        }
      }
    } catch {
      /* ignore */
    }
    if (chuteStore.get(key)?.item) activate('chute', key);
  },
  onBreak(dim, pos) {
    const key = dimKey(dim, pos);
    const d = chuteStore.get(key);
    if (d?.item) dropItem(dimension(dim), { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 }, d.item);
    chuteStore.delete(key);
  },
});

// ------------------------------------------------------------------ filters
export function filterOf(item: ItemStack | undefined): string[] | undefined {
  if (!item || item.typeId !== ID('filter')) return undefined;
  try {
    const raw = item.getDynamicProperty('cr:filter');
    return typeof raw === 'string' ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function openFilterUI(p: Player): void {
  const held = heldItem(p);
  if (!held || held.typeId !== ID('filter')) return;
  const list = filterOf(held) ?? [];
  const form = new ActionFormData()
    .title('Filter')
    .body(list.length ? `Allowed items:\n§7${list.map((s) => s.replace('minecraft:', '')).join('\n')}` : 'This filter is empty (it allows nothing). Add items from your hotbar.')
    .button('Add all hotbar items')
    .button('Clear filter')
    .button('Close');
  form.show(p).then((r) => {
    if (r.canceled || r.selection === undefined) return;
    const inv = p.getComponent('minecraft:inventory')?.container;
    const cur = heldItem(p);
    if (!inv || !cur || cur.typeId !== ID('filter')) return;
    let next = filterOf(cur) ?? [];
    if (r.selection === 0) {
      for (let i = 0; i < 9; i++) {
        const it = inv.getItem(i);
        if (it && it.typeId !== ID('filter') && !next.includes(it.typeId)) next.push(it.typeId);
      }
    } else if (r.selection === 1) next = [];
    else return;
    next = next.slice(0, 18);
    cur.setDynamicProperty('cr:filter', JSON.stringify(next));
    cur.setLore(next.length ? next.slice(0, 6).map((s) => `§7${s.replace('minecraft:', '')}`) : ['§8(empty)']);
    inv.setItem(p.selectedSlotIndex, cur);
    msg(p, `§aFilter updated (${next.length} entries).`);
  }).catch(() => undefined);
}

// ------------------------------------------------------------------ funnels
const FUNNELS = [ID('andesite_funnel'), ID('brass_funnel')];
interface FunnelData {
  extract?: boolean;
  filter?: string[];
}
const funnelStore = new BlockStore<FunnelData>('fun');

function funnelPass(b: Block, item: SItem): boolean {
  if (b.typeId !== ID('brass_funnel')) return true;
  const f = funnelStore.get(dimKey(b.dimension.id, b.location))?.filter;
  return !f || !f.length || f.includes(item.id);
}

registerPort(FUNNELS, {
  insert(b, item, face, simulate) {
    const f = facingOf(getStates(b));
    const st = funnelStore.get(dimKey(b.dimension.id, b.location));
    if (st?.extract || getStates(b)['craftoria:powered']) return 0;
    if (face !== f && face !== 'up') return 0;
    if (!funnelPass(b, item)) return 0;
    const attached = offset(b.location, OPPOSITE[f]);
    return insertAt(b.dimension, attached, item, f, simulate);
  },
});

function funnelTick(b: Block): void {
  const key = dimKey(b.dimension.id, b.location);
  const powered = (b.getRedstonePower() ?? 0) > 0;
  setState(b, 'craftoria:powered', powered);
  if (powered) return;
  const f = facingOf(getStates(b));
  const attached = offset(b.location, OPPOSITE[f]);
  const d = funnelStore.get(key) ?? {};
  const dim = b.dimension;
  if (!d.extract) {
    // absorb items at the mouth
    const v = DIR_VEC[f];
    const loc = { x: b.location.x + 0.5 + v.x * 0.3, y: b.location.y + 0.5 + v.y * 0.3, z: b.location.z + 0.5 + v.z * 0.3 };
    try {
      for (const e of dim.getEntities({ type: 'minecraft:item', location: loc, maxDistance: 0.8 })) {
        const st = e.getComponent('minecraft:item')?.itemStack;
        if (!st) continue;
        const s = toS(st);
        if (!funnelPass(b, s)) continue;
        const n = insertAt(dim, attached, s, f);
        if (n <= 0) continue;
        const l = e.location;
        e.remove();
        if (n < s.n) dropItem(dim, l, copy(s, s.n - n));
        sound(dim, 'craftoria.item_pop', loc, 0.3, 1.3);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  // extraction
  if (now() % 8 !== 0) return;
  const brass = b.typeId === ID('brass_funnel');
  const max = brass ? 16 : 1;
  const pred = (s: SItem) => funnelPass(b, s);
  const front = offset(b.location, f);
  const peek = extractAt(dim, attached, pred, max, f, true);
  if (!peek) return;
  const fb = blockAt(dim, front);
  if (!fb) return;
  let moved = 0;
  if (fb.isAir || fb.typeId === 'minecraft:air') {
    const got = extractAt(dim, attached, pred, max, f);
    if (got) {
      const v = DIR_VEC[f];
      dropItem(dim, { x: front.x + 0.5 - v.x * 0.3, y: front.y + 0.3, z: front.z + 0.5 - v.z * 0.3 }, got);
      moved = got.n;
    }
  } else {
    const can = insertAt(dim, front, peek, OPPOSITE[f], true);
    if (can > 0) {
      const got = extractAt(dim, attached, pred, can, f);
      if (got) {
        const n = insertAt(dim, front, got, OPPOSITE[f]);
        moved = n;
        if (n < got.n) insertAt(dim, attached, copy(got, got.n - n), f);
      }
    }
  }
  if (moved) sound(dim, 'craftoria.item_pop', b.center(), 0.25, 1.1);
}

registerMachine(FUNNELS, {
  onTick: funnelTick,
  onInteract(b: Block, p: Player): boolean {
    const key = dimKey(b.dimension.id, b.location);
    const held = heldItem(p);
    const d = funnelStore.get(key) ?? {};
    if (held?.typeId === ID('wrench')) return false;
    if (b.typeId === ID('brass_funnel')) {
      if (held) {
        const list = filterOf(held);
        d.filter = list ?? [held.typeId];
        msg(p, `§aFunnel filter: ${d.filter.length ? d.filter.map((s) => s.replace('minecraft:', '')).join(', ') : '(none)'}`);
      } else if (p.isSneaking) {
        d.filter = undefined;
        msg(p, '§eFunnel filter cleared.');
      } else {
        d.extract = !d.extract;
        msg(p, d.extract ? '§aFunnel mode: §fEXTRACT §7(pulls from the attached block)' : '§aFunnel mode: §fINSERT §7(feeds the attached block)');
      }
    } else {
      if (held) return false;
      d.extract = !d.extract;
      msg(p, d.extract ? '§aFunnel mode: §fEXTRACT §7(pulls from the attached block)' : '§aFunnel mode: §fINSERT §7(feeds the attached block)');
    }
    funnelStore.set(key, d);
    sound(b.dimension, 'craftoria.wrench', b.center(), 0.4, 1.2);
    return true;
  },
  onBreak(dim, pos) {
    funnelStore.delete(dimKey(dim, pos));
  },
});

export function tickChutes(): void {
  tickActive('chute', CHUTE, tickChute);
}

export function funnelMode(key: string): FunnelData | undefined {
  return funnelStore.get(key);
}

export { fromS };
export type { Dir };
