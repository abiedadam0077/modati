// Kinetic definitions of every CRAFTORIA block (pure: typeId + states -> node spec).
// Stress values follow Create's defaults (CStress, MIT): impact/capacity in SU per RPM.
import { AXIS_DIRS, Axis, DIR_AXIS, DIR_SIGN, Dir, OPPOSITE, perpendicularAxes } from '../util/vec';
import type { KBlockSpec, KNodeSpec } from './types';

export type States = Record<string, string | number | boolean>;

export const NS = 'craftoria';
export const ID = (s: string) => `${NS}:${s}`;

export const S_AXIS = 'craftoria:axis';
export const S_FACING = 'craftoria:facing';
export const S_POWERED = 'craftoria:powered';
export const S_ROTOR = 'craftoria:rotor';
export const S_PART = 'craftoria:part';
export const S_ALT = 'craftoria:alt';

export function axisOf(st: States): Axis {
  const a = st[S_AXIS];
  return a === 'x' || a === 'z' ? a : 'y';
}
export function facingOf(st: States): Dir {
  const f = st[S_FACING];
  return (typeof f === 'string' && f in DIR_AXIS ? f : 'north') as Dir;
}

/** Shaft axis perpendicular to a facing (saw / deployer / piston style blocks). */
export function sideAxis(f: Dir, alt: boolean): Axis {
  if (f === 'up' || f === 'down') return alt ? 'z' : 'x';
  const a = DIR_AXIS[f];
  // horizontal facing: the other horizontal axis, or vertical when alt
  if (alt) return 'y';
  return a === 'x' ? 'z' : 'x';
}

function node(p: Partial<KNodeSpec> & { axis: Axis }): KNodeSpec {
  return { sub: '', shafts: [], impact: 0, capacity: 0, ...p };
}
const both = (a: Axis): Dir[] => [...AXIS_DIRS[a]];

export interface RotorInfo {
  model: number;
  /** orientation source */
  orient: 'axis' | 'facing' | 'up';
  /** gear phase family for meshing offsets */
  phase?: 'small' | 'large';
}

export interface KineticDef {
  spec: (st: States) => KBlockSpec;
  rotor?: RotorInfo;
  /** generator kind (handled in generators.ts) */
  generator?: 'crank' | 'motor' | 'water_wheel' | 'windmill';
  /** machine kind (handled in machines) */
  machine?: string;
  /** minimum |RPM| for the machine to work */
  minSpeed?: number;
  /** needs redstone polling (clutch / gearshift) */
  redstone?: boolean;
}

// Rotor model indices (must match tools/content/visuals.mjs)
export const ROTOR = {
  shaft: 0, cog: 1, large_cog: 2, gearbox: 3, split_shaft: 4, crank: 5, motor: 6, water_wheel: 7,
  press: 8, mixer: 9, millstone: 10, crushing_wheel: 11, drill: 12, saw: 13, deployer: 14, arm: 15,
  fan: 16, pump: 17, bearing: 18, rope_pulley: 19, gauge: 20, windmill_bearing: 21, belt_pulley: 22,
  piston: 23, clutch: 24, gearshift: 25,
} as const;

export const KINETIC_DEFS: Record<string, KineticDef> = {
  [ID('shaft')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)) })] }),
    rotor: { model: ROTOR.shaft, orient: 'axis' },
  },
  [ID('cogwheel')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), cog: 'small' })] }),
    rotor: { model: ROTOR.cog, orient: 'axis', phase: 'small' },
  },
  [ID('large_cogwheel')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), cog: 'large' })] }),
    rotor: { model: ROTOR.large_cog, orient: 'axis', phase: 'large' },
  },
  [ID('gearbox')]: {
    spec: (st) => {
      const a = axisOf(st);
      const [p, q] = perpendicularAxes(a);
      // speed about the OUTWARD normal: +1 on +-p, -1 on +-q (bevel gear physics); factor = w * sign
      const ff: Partial<Record<Dir, number>> = {};
      for (const d of AXIS_DIRS[p]) ff[d] = 1 * DIR_SIGN[d];
      for (const d of AXIS_DIRS[q]) ff[d] = -1 * DIR_SIGN[d];
      return { nodes: [node({ axis: p, shafts: [...AXIS_DIRS[p], ...AXIS_DIRS[q]], faceFactor: ff })] };
    },
    rotor: { model: ROTOR.gearbox, orient: 'axis' },
  },
  [ID('clutch')]: {
    spec: (st) => {
      const a = axisOf(st);
      const [neg, pos] = AXIS_DIRS[a];
      const res: KBlockSpec = { nodes: [node({ sub: 'a', axis: a, shafts: [neg] }), node({ sub: 'b', axis: a, shafts: [pos] })] };
      if (!st[S_POWERED]) res.internal = [{ a: 'a', b: 'b', ratio: 1 }];
      return res;
    },
    rotor: { model: ROTOR.clutch, orient: 'axis' },
    redstone: true,
  },
  [ID('gearshift')]: {
    spec: (st) => {
      const a = axisOf(st);
      const [neg, pos] = AXIS_DIRS[a];
      return {
        nodes: [node({ sub: 'a', axis: a, shafts: [neg] }), node({ sub: 'b', axis: a, shafts: [pos] })],
        internal: [{ a: 'a', b: 'b', ratio: st[S_POWERED] ? -1 : 1 }],
      };
    },
    rotor: { model: ROTOR.gearshift, orient: 'axis' },
    redstone: true,
  },
  [ID('hand_crank')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [OPPOSITE[f]], capacity: 8 })] };
    },
    rotor: { model: ROTOR.crank, orient: 'facing' },
    generator: 'crank',
  },
  [ID('creative_motor')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [f], capacity: 16384 })] };
    },
    rotor: { model: ROTOR.motor, orient: 'facing' },
    generator: 'motor',
  },
  [ID('water_wheel')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), capacity: 32 })] }),
    rotor: { model: ROTOR.water_wheel, orient: 'axis' },
    generator: 'water_wheel',
  },
  [ID('windmill_bearing')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [OPPOSITE[f]], capacity: 512 })] };
    },
    rotor: { model: ROTOR.windmill_bearing, orient: 'facing' },
    generator: 'windmill',
    machine: 'windmill_bearing',
  },
  [ID('mechanical_press')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), impact: 8 })] }),
    rotor: { model: ROTOR.press, orient: 'axis' },
    machine: 'press',
  },
  [ID('mechanical_mixer')]: {
    spec: () => ({ nodes: [node({ axis: 'y', shafts: ['up'], cog: 'small', impact: 4 })] }),
    rotor: { model: ROTOR.mixer, orient: 'up', phase: 'small' },
    machine: 'mixer',
    minSpeed: 30,
  },
  [ID('millstone')]: {
    spec: () => ({ nodes: [node({ axis: 'y', shafts: ['down'], cog: 'small', impact: 4 })] }),
    rotor: { model: ROTOR.millstone, orient: 'up', phase: 'small' },
    machine: 'millstone',
  },
  [ID('crushing_wheel')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), impact: 8 })] }),
    rotor: { model: ROTOR.crushing_wheel, orient: 'axis' },
    machine: 'crushing_wheel',
  },
  [ID('mechanical_drill')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [OPPOSITE[f]], impact: 4 })] };
    },
    rotor: { model: ROTOR.drill, orient: 'facing' },
    machine: 'drill',
  },
  [ID('mechanical_saw')]: {
    spec: (st) => {
      const a = sideAxis(facingOf(st), !!st[S_ALT]);
      return { nodes: [node({ axis: a, shafts: both(a), impact: 4 })] };
    },
    rotor: { model: ROTOR.saw, orient: 'facing' },
    machine: 'saw',
  },
  [ID('deployer')]: {
    spec: (st) => {
      const a = sideAxis(facingOf(st), !!st[S_ALT]);
      return { nodes: [node({ axis: a, shafts: both(a), impact: 4 })] };
    },
    rotor: { model: ROTOR.deployer, orient: 'facing' },
    machine: 'deployer',
  },
  [ID('mechanical_arm')]: {
    spec: () => ({ nodes: [node({ axis: 'y', shafts: ['down'], cog: 'small', impact: 2 })] }),
    rotor: { model: ROTOR.arm, orient: 'up', phase: 'small' },
    machine: 'arm',
  },
  [ID('encased_fan')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [OPPOSITE[f]], impact: 2 })] };
    },
    rotor: { model: ROTOR.fan, orient: 'facing' },
    machine: 'fan',
  },
  [ID('mechanical_pump')]: {
    spec: (st) => {
      const a = DIR_AXIS[facingOf(st)];
      return { nodes: [node({ axis: a, shafts: both(a), cog: 'small', impact: 4 })] };
    },
    rotor: { model: ROTOR.pump, orient: 'facing', phase: 'small' },
    machine: 'pump',
  },
  [ID('mechanical_bearing')]: {
    spec: (st) => {
      const f = facingOf(st);
      return { nodes: [node({ axis: DIR_AXIS[f], shafts: [OPPOSITE[f]], impact: 4 })] };
    },
    rotor: { model: ROTOR.bearing, orient: 'facing' },
    machine: 'bearing',
  },
  [ID('rope_pulley')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)), impact: 4 })] }),
    rotor: { model: ROTOR.rope_pulley, orient: 'axis' },
    machine: 'pulley',
  },
  [ID('mechanical_piston')]: {
    spec: (st) => {
      const a = sideAxis(facingOf(st), !!st[S_ALT]);
      return { nodes: [node({ axis: a, shafts: both(a), impact: 4 })] };
    },
    rotor: { model: ROTOR.piston, orient: 'facing' },
    machine: 'piston',
  },
  [ID('speedometer')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)) })] }),
    rotor: { model: ROTOR.gauge, orient: 'axis' },
    machine: 'gauge',
  },
  [ID('stressometer')]: {
    spec: (st) => ({ nodes: [node({ axis: axisOf(st), shafts: both(axisOf(st)) })] }),
    rotor: { model: ROTOR.gauge, orient: 'axis' },
    machine: 'gauge',
  },
  [ID('belt')]: {
    spec: (st) => {
      const a = axisOf(st) === 'x' ? 'x' : 'z';
      const run: Axis = a === 'x' ? 'z' : 'x';
      const part = st[S_PART];
      const shafts = part === 'start' || part === 'end' ? both(a) : [];
      return { nodes: [node({ axis: a, shafts, beltRun: run })] };
    },
    rotor: { model: ROTOR.belt_pulley, orient: 'axis' },
    machine: 'belt',
  },
};

export function kineticDef(typeId: string): KineticDef | undefined {
  return KINETIC_DEFS[typeId];
}

export function isKinetic(typeId: string): boolean {
  return typeId in KINETIC_DEFS;
}
