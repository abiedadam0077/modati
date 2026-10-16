// Item serialization and container helpers.
import { Block, Container, EnchantmentType, ItemStack } from '@minecraft/server';
import { logError } from '../core/env';

/** Serialized item stack (persisted in dynamic properties). */
export interface SItem {
  id: string;
  n: number;
  name?: string;
  lore?: string[];
  dmg?: number;
  ench?: [string, number][];
  dp?: Record<string, string | number | boolean>;
}

const maxCache = new Map<string, number>();
export function maxStackOf(id: string): number {
  let m = maxCache.get(id);
  if (m === undefined) {
    try {
      m = new ItemStack(id, 1).maxAmount;
    } catch {
      m = 64;
    }
    maxCache.set(id, m);
  }
  return m;
}

export function isValidItemId(id: string): boolean {
  try {
    new ItemStack(id, 1);
    return true;
  } catch {
    return false;
  }
}

export function toS(stack: ItemStack): SItem {
  const s: SItem = { id: stack.typeId, n: stack.amount };
  try {
    if (stack.nameTag) s.name = stack.nameTag;
    const lore = stack.getLore();
    if (lore.length) s.lore = lore;
    const dur = stack.getComponent('minecraft:durability');
    if (dur && dur.damage > 0) s.dmg = dur.damage;
    const en = stack.getComponent('minecraft:enchantable');
    if (en) {
      const list = en.getEnchantments();
      if (list.length) s.ench = list.map((e) => [e.type.id, e.level]);
    }
    const ids = stack.getDynamicPropertyIds();
    if (ids.length) {
      s.dp = {};
      for (const id of ids) {
        const v = stack.getDynamicProperty(id);
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') s.dp[id] = v;
      }
    }
  } catch (e) {
    logError('toS', e);
  }
  return s;
}

export function fromS(s: SItem): ItemStack | undefined {
  try {
    const st = new ItemStack(s.id, Math.max(1, Math.min(s.n, maxStackOf(s.id))));
    if (s.name) st.nameTag = s.name;
    if (s.lore) st.setLore(s.lore);
    if (s.dmg) {
      const dur = st.getComponent('minecraft:durability');
      if (dur) dur.damage = Math.min(s.dmg, dur.maxDurability);
    }
    if (s.ench) {
      const en = st.getComponent('minecraft:enchantable');
      if (en) {
        for (const [id, level] of s.ench) {
          try {
            en.addEnchantment({ type: new EnchantmentType(id), level });
          } catch {
            /* incompatible */
          }
        }
      }
    }
    if (s.dp) for (const [k, v] of Object.entries(s.dp)) st.setDynamicProperty(k, v);
    return st;
  } catch (e) {
    logError(`fromS ${s.id}`, e);
    return undefined;
  }
}

export function simple(id: string, n = 1): SItem {
  return { id, n };
}

export function sameKind(a: SItem, b: SItem): boolean {
  if (a.id !== b.id) return false;
  if ((a.name ?? '') !== (b.name ?? '')) return false;
  if ((a.dmg ?? 0) !== (b.dmg ?? 0)) return false;
  if (JSON.stringify(a.ench ?? []) !== JSON.stringify(b.ench ?? [])) return false;
  if (JSON.stringify(a.lore ?? []) !== JSON.stringify(b.lore ?? [])) return false;
  if (JSON.stringify(a.dp ?? {}) !== JSON.stringify(b.dp ?? {})) return false;
  return true;
}

export function copy(s: SItem, n = s.n): SItem {
  return { ...s, n, lore: s.lore ? [...s.lore] : undefined, ench: s.ench ? s.ench.map((e) => [...e] as [string, number]) : undefined, dp: s.dp ? { ...s.dp } : undefined };
}

/** Merge `src` into the list of stacks (respecting max stack), returns amount that did not fit. */
export function mergeInto(list: SItem[], src: SItem, maxSlots: number, simulate = false): number {
  let left = src.n;
  const max = maxStackOf(src.id);
  const work = simulate ? list.map((s) => copy(s)) : list;
  for (const s of work) {
    if (left <= 0) break;
    if (!sameKind(s, src) || s.n >= max) continue;
    const t = Math.min(max - s.n, left);
    s.n += t;
    left -= t;
  }
  while (left > 0 && work.length < maxSlots) {
    const t = Math.min(max, left);
    work.push(copy(src, t));
    left -= t;
  }
  return left;
}

export function countOf(list: SItem[], pred: (s: SItem) => boolean): number {
  let n = 0;
  for (const s of list) if (pred(s)) n += s.n;
  return n;
}

/** Remove `count` items matching pred; returns removed stacks */
export function takeFrom(list: SItem[], pred: (s: SItem) => boolean, count: number): SItem[] {
  const out: SItem[] = [];
  for (let i = 0; i < list.length && count > 0; i++) {
    const s = list[i];
    if (!pred(s)) continue;
    const t = Math.min(s.n, count);
    out.push(copy(s, t));
    s.n -= t;
    count -= t;
    if (s.n <= 0) {
      list.splice(i, 1);
      i--;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Item tags (vanilla tags via ItemStack.hasTag, plus a few CRAFTORIA groupings)
const tagCache = new Map<string, boolean>();
export function hasTag(id: string, tag: string): boolean {
  const k = `${id}#${tag}`;
  let v = tagCache.get(k);
  if (v === undefined) {
    v = false;
    try {
      v = new ItemStack(id, 1).hasTag(tag);
    } catch {
      v = false;
    }
    if (!v) v = extraTag(id, tag);
    tagCache.set(k, v);
  }
  return v;
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
function extraTag(id: string, tag: string): boolean {
  const n = id.replace('minecraft:', '');
  switch (tag) {
    case 'craftoria:stripped_logs':
      return /^stripped_.*(_log|_wood|_stem|_hyphae)$/.test(n) || n === 'stripped_bamboo_block';
    case 'craftoria:logs':
      return /(_log|_wood|_stem|_hyphae)$/.test(n) && !n.startsWith('stripped_');
    case 'minecraft:planks':
      return /_planks$/.test(n);
    case 'craftoria:wool':
      return /_wool$/.test(n);
    case 'craftoria:saplings':
      return /_sapling$/.test(n);
    default:
      return false;
  }
}
export function woodOf(id: string): string | undefined {
  const n = id.replace('minecraft:', '');
  for (const w of [...WOODS, 'crimson', 'warped', 'bamboo']) if (n.includes(w)) return w;
  return undefined;
}

// ---------------------------------------------------------------------------
// Vanilla containers
const FURNACES = new Set(['minecraft:furnace', 'minecraft:lit_furnace', 'minecraft:blast_furnace', 'minecraft:lit_blast_furnace', 'minecraft:smoker', 'minecraft:lit_smoker']);
const FUELS = new Set(['minecraft:coal', 'minecraft:charcoal', 'minecraft:coal_block', 'minecraft:blaze_rod', 'minecraft:lava_bucket', 'minecraft:stick', 'minecraft:dried_kelp_block']);

export function getContainer(b: Block): Container | undefined {
  try {
    const inv = b.getComponent('minecraft:inventory');
    const c = inv?.container;
    return c && c.isValid ? c : undefined;
  } catch {
    return undefined;
  }
}

/** Insert into a vanilla container respecting furnace slots. face = side of the container being inserted into. */
export function insertIntoContainer(b: Block, c: Container, s: SItem, face: string, simulate: boolean): number {
  try {
    if (FURNACES.has(b.typeId)) {
      const slot = face === 'up' ? 0 : FUELS.has(s.id) || s.id.endsWith('_planks') || s.id.endsWith('_log') ? 1 : 0;
      return insertSlot(c, slot, s, simulate);
    }
    let left = s.n;
    const max = maxStackOf(s.id);
    // fill existing stacks first
    for (let i = 0; i < c.size && left > 0; i++) {
      const it = c.getItem(i);
      if (!it || it.typeId !== s.id || it.amount >= it.maxAmount) continue;
      if (!sameKind(toS(it), { ...s, n: it.amount })) continue;
      const t = Math.min(it.maxAmount - it.amount, left);
      if (!simulate) {
        it.amount += t;
        c.setItem(i, it);
      }
      left -= t;
    }
    for (let i = 0; i < c.size && left > 0; i++) {
      if (c.getItem(i)) continue;
      const t = Math.min(max, left);
      if (!simulate) {
        const st = fromS(copy(s, t));
        if (!st) break;
        c.setItem(i, st);
      }
      left -= t;
    }
    return s.n - left;
  } catch (e) {
    logError('insertIntoContainer', e);
    return 0;
  }
}

function insertSlot(c: Container, slot: number, s: SItem, simulate: boolean): number {
  const it = c.getItem(slot);
  if (!it) {
    const t = Math.min(maxStackOf(s.id), s.n);
    if (!simulate) {
      const st = fromS(copy(s, t));
      if (!st) return 0;
      c.setItem(slot, st);
    }
    return t;
  }
  if (it.typeId !== s.id || it.amount >= it.maxAmount) return 0;
  const t = Math.min(it.maxAmount - it.amount, s.n);
  if (!simulate) {
    it.amount += t;
    c.setItem(slot, it);
  }
  return t;
}

/** Extract up to max items matching pred from a vanilla container. */
export function extractFromContainer(b: Block, c: Container, pred: (s: SItem) => boolean, max: number, face: string, simulate = false): SItem | undefined {
  try {
    const slots: number[] = [];
    if (FURNACES.has(b.typeId)) slots.push(face === 'down' ? 2 : 2);
    else for (let i = 0; i < c.size; i++) slots.push(i);
    for (const i of slots) {
      const it = c.getItem(i);
      if (!it) continue;
      const s = toS(it);
      if (!pred(s)) continue;
      const t = Math.min(max, it.amount);
      if (!simulate) {
        if (t >= it.amount) c.setItem(i, undefined);
        else {
          it.amount -= t;
          c.setItem(i, it);
        }
      }
      return copy(s, t);
    }
  } catch (e) {
    logError('extractFromContainer', e);
  }
  return undefined;
}
