// Pure kinetic network solver.
// Given one connected component (nodes + ratio edges), the generators in it and per-node stress
// impacts, computes the speed of every node and the network status.
//
// Behaviour (inspired by Create's KineticNetwork/RotationPropagator, MIT):
//  * The source implying the fastest network speed dominates; slower same-direction sources are
//    overpowered but still add their capacity (capacity uses each source's own generated speed).
//  * Sources implying opposite directions, or a gear loop with inconsistent ratios => 'conflict'.
//  * Any node above the speed limit => 'overspeed'.
//  * Total impact above total capacity => 'overstressed' (whole network stops).
//  Unlike Create, faults never destroy blocks: the network simply stops and reports the fault.
import type { GeneratorInput, KEdge, SolveResult } from './types';

export const MAX_SPEED = 256;
const EPS = 1e-6;

export function solveNetwork(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly KEdge[]>,
  impacts: ReadonlyMap<string, number>,
  gens: ReadonlyMap<string, GeneratorInput>,
  maxSpeed = MAX_SPEED,
): SolveResult {
  const speeds = new Map<string, number>();
  const zero = () => {
    for (const k of nodes) speeds.set(k, 0);
  };
  if (nodes.length === 0) return { status: 'stopped', speeds, capacity: 0, impact: 0 };

  // 1. relative ratios w.r.t. the first node, with loop consistency check
  const rel = new Map<string, number>();
  const start = nodes[0];
  rel.set(start, 1);
  const queue: string[] = [start];
  let conflictAt: string | undefined;
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const rk = rel.get(k)!;
    for (const e of edges.get(k) ?? []) {
      const expect = rk * e.ratio;
      const have = rel.get(e.to);
      if (have === undefined) {
        rel.set(e.to, expect);
        queue.push(e.to);
      } else if (Math.abs(have - expect) > EPS * Math.max(1, Math.abs(have), Math.abs(expect))) {
        conflictAt ??= e.to;
      }
    }
  }
  // nodes unreachable from start (should not happen for a proper component) get ratio 0
  for (const k of nodes) if (!rel.has(k)) rel.set(k, 0);

  // 2. capacity is the sum of all active sources (own generated speed)
  let capacity = 0;
  const active: [string, GeneratorInput][] = [];
  for (const [k, g] of gens) {
    if (!rel.has(k)) continue;
    if (g.speed !== 0) {
      active.push([k, g]);
      capacity += g.capacity * Math.abs(g.speed);
    }
  }
  if (conflictAt !== undefined && active.length > 0) {
    zero();
    return { status: 'conflict', speeds, capacity, impact: 0, faultAt: conflictAt };
  }
  if (active.length === 0) {
    zero();
    return { status: 'stopped', speeds, capacity: 0, impact: 0 };
  }

  // 3. dominant source
  let rootKey = active[0][0];
  let rootRef = 0;
  for (const [k, g] of active) {
    const r = rel.get(k)!;
    if (r === 0) continue;
    const implied = g.speed / r;
    if (Math.abs(implied) > Math.abs(rootRef) + EPS) {
      rootRef = implied;
      rootKey = k;
    }
  }
  for (const [k, g] of active) {
    const r = rel.get(k)!;
    if (r === 0) continue;
    const implied = g.speed / r;
    if (implied * rootRef < 0) {
      zero();
      return { status: 'conflict', speeds, capacity, impact: 0, faultAt: k, root: rootKey };
    }
  }

  // 4. speeds + overspeed check
  let over: string | undefined;
  for (const k of nodes) {
    let s = rootRef * rel.get(k)!;
    s = Math.round(s * 10000) / 10000;
    if (Object.is(s, -0)) s = 0;
    speeds.set(k, s);
    if (Math.abs(s) > maxSpeed + 1e-3) over ??= k;
  }
  if (over !== undefined) {
    zero();
    return { status: 'overspeed', speeds, capacity, impact: 0, faultAt: over, root: rootKey };
  }

  // 5. stress
  let impact = 0;
  for (const k of nodes) {
    const imp = impacts.get(k) ?? 0;
    if (imp) impact += imp * Math.abs(speeds.get(k)!);
  }
  impact = Math.round(impact * 100) / 100;
  if (impact > capacity + 1e-3) {
    zero();
    return { status: 'overstressed', speeds, capacity, impact, root: rootKey };
  }
  return { status: 'running', speeds, capacity, impact, root: rootKey };
}
