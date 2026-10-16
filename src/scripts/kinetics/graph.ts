// Pure component discovery over kinetic connections (BFS).
import { V3, posKey } from '../util/vec';
import { neighborsOf } from './connect';
import type { KBlockSpec, KEdge, KNodeSpec } from './types';

export interface BlockInfo {
  typeId: string;
  spec: KBlockSpec;
}

export interface CompNode {
  key: string;
  pos: V3;
  sub: string;
  typeId: string;
  spec: KNodeSpec;
}

export function nodeKey(pos: V3, sub: string): string {
  return sub ? `${posKey(pos)}#${sub}` : posKey(pos);
}

export interface Component {
  nodes: CompNode[];
  edges: Map<string, KEdge[]>;
  truncated: boolean;
}

/**
 * Discover the connected component containing (pos, sub).
 * `lookup` returns block info or undefined (air / non kinetic / unloaded).
 */
export function discoverComponent(
  start: V3,
  startSub: string | null,
  lookup: (pos: V3) => BlockInfo | undefined,
  maxNodes = 4096,
): Component {
  const nodes: CompNode[] = [];
  const edges = new Map<string, KEdge[]>();
  const seen = new Map<string, CompNode>();
  const cache = new Map<string, BlockInfo | null>();
  const look = (p: V3): BlockInfo | undefined => {
    const k = posKey(p);
    let v = cache.get(k);
    if (v === undefined) {
      v = lookup(p) ?? null;
      cache.set(k, v);
    }
    return v ?? undefined;
  };
  const specLookup = (p: V3) => look(p)?.spec;
  const queue: CompNode[] = [];
  const first = look(start);
  if (!first) return { nodes, edges, truncated: false };
  const starts = startSub === null ? first.spec.nodes : first.spec.nodes.filter((n) => n.sub === startSub);
  // when starting from a whole block, only the first sub-node is seeded; others are reached via links
  // or seeded separately by the caller.
  for (const n of starts.slice(0, 1)) {
    const cn: CompNode = { key: nodeKey(start, n.sub), pos: start, sub: n.sub, typeId: first.typeId, spec: n };
    seen.set(cn.key, cn);
    queue.push(cn);
  }
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    nodes.push(cur);
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    const blk = look(cur.pos)!;
    const list: KEdge[] = [];
    for (const nb of neighborsOf(cur.pos, cur.spec, blk.spec, specLookup)) {
      const k = nodeKey(nb.pos, nb.sub);
      list.push({ to: k, ratio: nb.ratio });
      if (!seen.has(k)) {
        const info = look(nb.pos)!;
        const spec = info.spec.nodes.find((n) => n.sub === nb.sub)!;
        const cn: CompNode = { key: k, pos: nb.pos, sub: nb.sub, typeId: info.typeId, spec };
        seen.set(k, cn);
        queue.push(cn);
      }
    }
    edges.set(cur.key, list);
  }
  if (truncated) {
    // keep only edges between discovered nodes
    const keys = new Set(nodes.map((n) => n.key));
    for (const [k, l] of edges) edges.set(k, l.filter((e) => keys.has(e.to)));
  }
  return { nodes, edges, truncated };
}
