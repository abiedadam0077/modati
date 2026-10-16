// Pure connection rules between kinetic nodes.
// Ratios ported/adapted from Create's RotationPropagator (MIT) and re-derived physically:
//   - coaxial shafts:          speed equal per face factor
//   - small <-> small cogs:    -1 (face adjacent, same axis)
//   - large -> small cog:      -2 (diagonal in the plane perpendicular to the shared axis)
//   - small -> large cog:      -0.5
//   - large <-> large cogs:    +-1 (perpendicular axes, diagonal), sign per Create's rule
//   - belt segments:           1 along the run axis
import { AXIS_DIRS, Axis, DIR_AXIS, Dir, OPPOSITE, V3, comp, offset, perpendicularAxes, perpendicularDirs, sub } from '../util/vec';
import type { KBlockSpec, KNodeSpec } from './types';

export type SpecLookup = (pos: V3) => KBlockSpec | undefined;

export interface Neighbor {
  pos: V3;
  sub: string;
  ratio: number;
}

function factor(n: KNodeSpec, d: Dir): number {
  return n.faceFactor?.[d] ?? 1;
}

/** All kinetic neighbours of node `node` located at `pos`. */
export function neighborsOf(pos: V3, node: KNodeSpec, block: KBlockSpec, lookup: SpecLookup): Neighbor[] {
  const out: Neighbor[] = [];
  // internal links
  if (block.internal) {
    for (const l of block.internal) {
      if (l.a === node.sub) out.push({ pos, sub: l.b, ratio: l.ratio });
      else if (l.b === node.sub) out.push({ pos, sub: l.a, ratio: 1 / l.ratio });
    }
  }
  // coaxial shafts
  for (const d of node.shafts) {
    const np = offset(pos, d);
    const nb = lookup(np);
    if (!nb) continue;
    const od = OPPOSITE[d];
    for (const other of nb.nodes) {
      if (!other.shafts.includes(od)) continue;
      const fa = factor(node, d), fb = factor(other, od);
      if (fa === 0 || fb === 0) continue;
      out.push({ pos: np, sub: other.sub, ratio: fa / fb });
    }
  }
  // cogs
  if (node.cog) {
    const a = node.axis;
    if (node.cog === 'small') {
      for (const d of perpendicularDirs(a)) {
        const np = offset(pos, d);
        const nb = lookup(np);
        if (!nb) continue;
        for (const other of nb.nodes) {
          if (other.cog === 'small' && other.axis === a) out.push({ pos: np, sub: other.sub, ratio: -1 });
        }
      }
    }
    // diagonal (in the plane perpendicular to the axis): large <-> small
    const [p, q] = perpendicularAxes(a);
    for (const dp of AXIS_DIRS[p]) {
      for (const dq of AXIS_DIRS[q]) {
        const np = offset(offset(pos, dp), dq);
        const nb = lookup(np);
        if (!nb) continue;
        for (const other of nb.nodes) {
          if (!other.cog || other.axis !== a) continue;
          if (node.cog === 'large' && other.cog === 'small') out.push({ pos: np, sub: other.sub, ratio: -2 });
          else if (node.cog === 'small' && other.cog === 'large') out.push({ pos: np, sub: other.sub, ratio: -0.5 });
        }
      }
    }
    // large <-> large with perpendicular axes
    if (node.cog === 'large') {
      for (const da of AXIS_DIRS[a]) {
        for (const b of perpendicularAxes(a)) {
          for (const db of AXIS_DIRS[b]) {
            const np = offset(offset(pos, da), db);
            const nb = lookup(np);
            if (!nb) continue;
            for (const other of nb.nodes) {
              if (other.cog !== 'large' || other.axis !== b) continue;
              const diff = sub(np, pos);
              const sa = comp(diff, a) > 0, sb = comp(diff, b) > 0;
              out.push({ pos: np, sub: other.sub, ratio: sa !== sb ? -1 : 1 });
            }
          }
        }
      }
    }
  }
  // belts
  if (node.beltRun) {
    for (const d of AXIS_DIRS[node.beltRun]) {
      const np = offset(pos, d);
      const nb = lookup(np);
      if (!nb) continue;
      for (const other of nb.nodes) {
        if (other.beltRun === node.beltRun && other.axis === node.axis) out.push({ pos: np, sub: other.sub, ratio: 1 });
      }
    }
  }
  return out;
}

/** Axis of a direction (re-export for convenience) */
export function axisOf(d: Dir): Axis {
  return DIR_AXIS[d];
}
