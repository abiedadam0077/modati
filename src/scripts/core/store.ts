// Persistent storage on world dynamic properties.
// Per-block entries use one property each (small values, written only when dirty).
import { world } from '@minecraft/server';
import { logError } from './env';

const DIM_SHORT: Record<string, string> = { 'minecraft:overworld': 'o', 'minecraft:nether': 'n', 'minecraft:the_end': 'e' };
const DIM_LONG: Record<string, string> = { o: 'minecraft:overworld', n: 'minecraft:nether', e: 'minecraft:the_end' };

export function shortKey(dimKey: string): string {
  const i = dimKey.indexOf('|');
  const d = dimKey.slice(0, i);
  return `${DIM_SHORT[d] ?? d}|${dimKey.slice(i + 1)}`;
}
export function longKey(short: string): string {
  const i = short.indexOf('|');
  const d = short.slice(0, i);
  return `${DIM_LONG[d] ?? d}|${short.slice(i + 1)}`;
}

const MAX_CHUNK = 30000;
const stores: BlockStore<object>[] = [];

export class BlockStore<T extends object> {
  private cache = new Map<string, T | null>();
  private dirty = new Set<string>();
  constructor(readonly prefix: string) {
    stores.push(this as unknown as BlockStore<object>);
  }
  private pid(key: string): string {
    return `cr:${this.prefix}:${shortKey(key)}`;
  }
  get(key: string): T | undefined {
    let v = this.cache.get(key);
    if (v === undefined) {
      v = null;
      try {
        const raw = world.getDynamicProperty(this.pid(key));
        if (typeof raw === 'string' && raw.length) v = JSON.parse(raw) as T;
      } catch (e) {
        logError(`store.get ${this.prefix}`, e);
      }
      this.cache.set(key, v);
    }
    return v ?? undefined;
  }
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  set(key: string, value: T): void {
    this.cache.set(key, value);
    this.dirty.add(key);
  }
  markDirty(key: string): void {
    if (this.cache.get(key)) this.dirty.add(key);
  }
  delete(key: string): void {
    this.cache.set(key, null);
    this.dirty.add(key);
  }
  /** keys currently cached (loaded) with a value */
  loadedKeys(): string[] {
    const out: string[] = [];
    for (const [k, v] of this.cache) if (v) out.push(k);
    return out;
  }
  flush(limit = 400): number {
    let n = 0;
    for (const key of this.dirty) {
      if (n >= limit) break;
      this.dirty.delete(key);
      n++;
      const v = this.cache.get(key);
      try {
        if (!v) world.setDynamicProperty(this.pid(key), undefined);
        else {
          const s = JSON.stringify(v);
          if (s.length > MAX_CHUNK) {
            logError(`store ${this.prefix}`, new Error(`entry too large (${s.length}) for ${key}, truncated save skipped`));
            continue;
          }
          world.setDynamicProperty(this.pid(key), s);
        }
      } catch (e) {
        logError(`store.flush ${this.prefix}`, e);
      }
    }
    return n;
  }
  /** Enumerate all persisted keys of this store (expensive; used at startup for global systems). */
  allPersistedKeys(): string[] {
    const pre = `cr:${this.prefix}:`;
    const out: string[] = [];
    try {
      for (const id of world.getDynamicPropertyIds()) if (id.startsWith(pre)) out.push(longKey(id.slice(pre.length)));
    } catch (e) {
      logError('store.keys', e);
    }
    return out;
  }
}

export function flushAllStores(limitPerStore = 400): void {
  for (const s of stores) s.flush(limitPerStore);
}

/** Global JSON values split over several properties when large. */
export const globalStore = {
  get<T>(name: string): T | undefined {
    try {
      const n = world.getDynamicProperty(`cr:g:${name}:n`);
      if (typeof n !== 'number') return undefined;
      let s = '';
      for (let i = 0; i < n; i++) {
        const part = world.getDynamicProperty(`cr:g:${name}:${i}`);
        if (typeof part !== 'string') return undefined;
        s += part;
      }
      return JSON.parse(s) as T;
    } catch (e) {
      logError(`globalStore.get ${name}`, e);
      return undefined;
    }
  },
  set(name: string, value: unknown): void {
    try {
      const s = JSON.stringify(value);
      const old = world.getDynamicProperty(`cr:g:${name}:n`);
      const parts = Math.max(1, Math.ceil(s.length / MAX_CHUNK));
      for (let i = 0; i < parts; i++) world.setDynamicProperty(`cr:g:${name}:${i}`, s.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK));
      if (typeof old === 'number') for (let i = parts; i < old; i++) world.setDynamicProperty(`cr:g:${name}:${i}`, undefined);
      world.setDynamicProperty(`cr:g:${name}:n`, parts);
    } catch (e) {
      logError(`globalStore.set ${name}`, e);
    }
  },
};
