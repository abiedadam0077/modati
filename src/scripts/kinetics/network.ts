// World integration of the kinetic solver: discovery, dirty tracking, result application.
//
// Design (improves on known Create/Bedrock-port issues):
//  * The world (blocks + block states) is the single source of truth; networks are always
//    re-derived from it, so a reload or chunk reload can never leave "phantom" power.
//  * Nodes in unloaded chunks are treated as absent (never forces chunk loading).
//  * Recomputation is incremental: topology changes re-discover only the affected component;
//    generator changes only re-solve an already known component.
import { Dimension } from '@minecraft/server';
import { V3, dimKey, posKey, offset, DIRS } from '../util/vec';
import { blockAt, dimension, getStates, logError } from '../core/env';
import { KINETIC_DEFS, kineticDef } from './defs';
import { BlockInfo, CompNode, discoverComponent, nodeKey } from './graph';
import { solveNetwork } from './solver';
import type { GeneratorInput, KEdge, NetStatus } from './types';

export interface NetState {
  id: number;
  dim: string;
  nodes: CompNode[];
  edges: Map<string, KEdge[]>;
  status: NetStatus;
  capacity: number;
  impact: number;
  faultAt?: string;
  truncated: boolean;
}

type GenProvider = (dim: Dimension, node: CompNode) => GeneratorInput | undefined;
type SpeedListener = (dim: string, node: CompNode, oldSpeed: number, newSpeed: number, net: NetState | undefined) => void;

const nets = new Map<number, NetState>();
const nodeNet = new Map<string, number>(); // dim|nodeKey -> net id
const nodeSpeed = new Map<string, number>(); // dim|nodeKey -> speed
const seeds = new Map<string, { dim: string; pos: V3 }>();
const resolveQueue = new Set<number>();
let nextId = 1;
let genProvider: GenProvider = () => undefined;
const listeners: SpeedListener[] = [];

// spatial index of known kinetic blocks: dim -> chunkKey -> Set<posKey>
const index = new Map<string, Map<string, Set<string>>>();

export const MAX_NETWORK_NODES = 4096;

export function setGeneratorProvider(p: GenProvider): void {
  genProvider = p;
}
export function onSpeedChange(l: SpeedListener): void {
  listeners.push(l);
}

function nk(dim: string, key: string): string {
  return `${dim}|${key}`;
}
function chunkKeyOf(p: V3): string {
  return `${p.x >> 4},${p.z >> 4}`;
}

export function indexAdd(dim: string, p: V3): void {
  let m = index.get(dim);
  if (!m) index.set(dim, (m = new Map()));
  const ck = chunkKeyOf(p);
  let s = m.get(ck);
  if (!s) m.set(ck, (s = new Set()));
  s.add(posKey(p));
}
export function indexRemove(dim: string, p: V3): void {
  const s = index.get(dim)?.get(chunkKeyOf(p));
  if (s) s.delete(posKey(p));
}
/** Known kinetic block positions within the chunk square around a location. */
export function indexNear(dim: string, p: V3, radius: number): string[] {
  const m = index.get(dim);
  if (!m) return [];
  const out: string[] = [];
  const c0x = (p.x - radius) >> 4, c1x = (p.x + radius) >> 4, c0z = (p.z - radius) >> 4, c1z = (p.z + radius) >> 4;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      const s = m.get(`${cx},${cz}`);
      if (s) for (const k of s) out.push(k);
    }
  }
  return out;
}

/** Block info lookup used by discovery (never throws). */
export function lookupFor(dim: Dimension): (p: V3) => BlockInfo | undefined {
  return (p: V3) => {
    const b = blockAt(dim, p);
    if (!b) return undefined;
    const def = KINETIC_DEFS[b.typeId];
    if (!def) return undefined;
    try {
      return { typeId: b.typeId, spec: def.spec(getStates(b)) };
    } catch {
      return undefined;
    }
  };
}

/** A kinetic block was placed/removed/changed state at pos: rediscover around it. */
export function markTopologyDirty(dim: string, pos: V3): void {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const p = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
        seeds.set(dimKey(dim, p), { dim, pos: p });
      }
}

/** Only generator output changed: re-solve the known network (cheap). */
export function markGeneratorDirty(dim: string, pos: V3): void {
  const def = kineticDef(blockTypeAt(dim, pos) ?? '');
  const subs = def ? def.spec({}).nodes.map((n) => n.sub) : [''];
  for (const s of subs) {
    const id = nodeNet.get(nk(dim, nodeKey(pos, s)));
    if (id !== undefined && nets.has(id)) {
      resolveQueue.add(id);
      return;
    }
  }
  seeds.set(dimKey(dim, pos), { dim, pos });
}

function blockTypeAt(dim: string, pos: V3): string | undefined {
  return blockAt(dimension(dim), pos)?.typeId;
}

export function isKnownNode(dim: string, pos: V3): boolean {
  return nodeNet.has(nk(dim, posKey(pos))) || nodeNet.has(nk(dim, `${posKey(pos)}#a`));
}

export function speedOf(dim: string, pos: V3, sub = ''): number {
  return nodeSpeed.get(nk(dim, nodeKey(pos, sub))) ?? 0;
}

export function netOf(dim: string, pos: V3, sub = ''): NetState | undefined {
  const id = nodeNet.get(nk(dim, nodeKey(pos, sub)));
  return id === undefined ? undefined : nets.get(id);
}

export function networkCount(): number {
  return nets.size;
}

/** Process pending work within a node budget. */
export function processNetworks(budget = 3000): void {
  let spent = 0;
  // 1. topology rediscovery
  if (seeds.size) {
    const roundAssigned = new Set<string>();
    const replaced = new Set<number>();
    const created: NetState[] = [];
    for (const [sk, seed] of seeds) {
      if (spent > budget) break;
      seeds.delete(sk);
      const dim = dimension(seed.dim);
      const look = lookupFor(dim);
      const info = look(seed.pos);
      const pk = posKey(seed.pos);
      if (!info) {
        // not kinetic (anymore): clear any stale node data at this position
        for (const s of ['', 'a', 'b']) {
          const key = nk(seed.dim, s ? `${pk}#${s}` : pk);
          const old = nodeNet.get(key);
          if (old !== undefined) replaced.add(old);
          if (nodeSpeed.has(key) && !roundAssigned.has(key)) {
            nodeSpeed.delete(key);
            nodeNet.delete(key);
          }
        }
        indexRemove(seed.dim, seed.pos);
        continue;
      }
      indexAdd(seed.dim, seed.pos);
      for (const n of info.spec.nodes) {
        const key = nk(seed.dim, nodeKey(seed.pos, n.sub));
        if (roundAssigned.has(key)) continue;
        const comp = discoverComponent(seed.pos, n.sub, look, MAX_NETWORK_NODES);
        spent += comp.nodes.length;
        const net: NetState = {
          id: nextId++, dim: seed.dim, nodes: comp.nodes, edges: comp.edges, status: 'stopped',
          capacity: 0, impact: 0, truncated: comp.truncated,
        };
        for (const cn of comp.nodes) {
          const ck = nk(seed.dim, cn.key);
          roundAssigned.add(ck);
          const old = nodeNet.get(ck);
          if (old !== undefined) replaced.add(old);
          indexAdd(seed.dim, cn.pos);
        }
        created.push(net);
      }
    }
    // retire replaced networks (nodes not reassigned stop)
    for (const id of replaced) {
      const old = nets.get(id);
      nets.delete(id);
      resolveQueue.delete(id);
      if (!old) continue;
      for (const cn of old.nodes) {
        const ck = nk(old.dim, cn.key);
        if (roundAssigned.has(ck)) continue;
        const prev = nodeSpeed.get(ck) ?? 0;
        nodeSpeed.delete(ck);
        nodeNet.delete(ck);
        if (prev !== 0) emit(old.dim, cn, prev, 0, undefined);
      }
    }
    for (const net of created) {
      nets.set(net.id, net);
      for (const cn of net.nodes) nodeNet.set(nk(net.dim, cn.key), net.id);
      solveAndApply(net);
    }
  }
  // 2. generator-only re-solves
  for (const id of resolveQueue) {
    if (spent > budget * 2) break;
    resolveQueue.delete(id);
    const net = nets.get(id);
    if (!net) continue;
    spent += net.nodes.length;
    solveAndApply(net);
  }
}

function solveAndApply(net: NetState): void {
  const dim = dimension(net.dim);
  const gens = new Map<string, GeneratorInput>();
  const impacts = new Map<string, number>();
  for (const cn of net.nodes) {
    if (cn.spec.impact) impacts.set(cn.key, cn.spec.impact);
    if (cn.spec.capacity) {
      try {
        const g = genProvider(dim, cn);
        if (g) gens.set(cn.key, g);
      } catch (e) {
        logError('generator', e);
      }
    }
  }
  const res = solveNetwork(net.nodes.map((n) => n.key), net.edges, impacts, gens);
  net.status = net.truncated ? 'too_large' : res.status;
  net.capacity = res.capacity;
  net.impact = res.impact;
  net.faultAt = res.faultAt;
  for (const cn of net.nodes) {
    const ck = nk(net.dim, cn.key);
    const prev = nodeSpeed.get(ck) ?? 0;
    const next = net.truncated ? 0 : res.speeds.get(cn.key) ?? 0;
    nodeSpeed.set(ck, next);
    if (prev !== next) emit(net.dim, cn, prev, next, net);
  }
}

function emit(dim: string, cn: CompNode, a: number, b: number, net: NetState | undefined): void {
  for (const l of listeners) {
    try {
      l(dim, cn, a, b, net);
    } catch (e) {
      logError('speed listener', e);
    }
  }
}

/** Re-solve every network periodically (generators with continuous output, e.g. water wheels). */
export function resolveAll(filter: (n: NetState) => boolean): void {
  for (const net of nets.values()) if (filter(net)) resolveQueue.add(net.id);
}

export function allNets(): IterableIterator<NetState> {
  return nets.values();
}

/** Neighbour positions that may host connected kinetic blocks (for break handling). */
export function neighborhood(pos: V3): V3[] {
  return DIRS.map((d) => offset(pos, d));
}
