// Basic vector / direction helpers (pure, no Minecraft imports).

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type Axis = 'x' | 'y' | 'z';
export type Dir = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

export const DIRS: readonly Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];
export const HORIZONTAL: readonly Dir[] = ['north', 'south', 'west', 'east'];
export const AXES: readonly Axis[] = ['x', 'y', 'z'];

export const DIR_VEC: Record<Dir, V3> = {
  down: { x: 0, y: -1, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = {
  down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west',
};

export const DIR_AXIS: Record<Dir, Axis> = {
  down: 'y', up: 'y', north: 'z', south: 'z', west: 'x', east: 'x',
};

/** +1 if the direction points along the positive axis */
export const DIR_SIGN: Record<Dir, number> = {
  down: -1, up: 1, north: -1, south: 1, west: -1, east: 1,
};

export const AXIS_DIRS: Record<Axis, [Dir, Dir]> = {
  x: ['west', 'east'],
  y: ['down', 'up'],
  z: ['north', 'south'],
};

export function dirFromAxis(axis: Axis, positive: boolean): Dir {
  return AXIS_DIRS[axis][positive ? 1 : 0];
}

export function perpendicularAxes(a: Axis): [Axis, Axis] {
  return a === 'x' ? ['y', 'z'] : a === 'y' ? ['x', 'z'] : ['x', 'y'];
}

export function perpendicularDirs(a: Axis): Dir[] {
  const [p, q] = perpendicularAxes(a);
  return [...AXIS_DIRS[p], ...AXIS_DIRS[q]];
}

export function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function offset(p: V3, d: Dir, n = 1): V3 {
  const v = DIR_VEC[d];
  return { x: p.x + v.x * n, y: p.y + v.y * n, z: p.z + v.z * n };
}
export function eq(a: V3, b: V3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
export function floorV(p: V3): V3 {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}
export function center(p: V3): V3 {
  return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
}
export function bottomCenter(p: V3): V3 {
  return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
}
export function dist2(a: V3, b: V3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
export function len(a: V3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
export function comp(v: V3, a: Axis): number {
  return a === 'x' ? v.x : a === 'y' ? v.y : v.z;
}
export function axisUnit(a: Axis): V3 {
  return a === 'x' ? { x: 1, y: 0, z: 0 } : a === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}
export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** Block key "x,y,z" */
export function posKey(p: V3): string {
  return `${p.x},${p.y},${p.z}`;
}
export function parsePosKey(k: string): V3 {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
}
/** Dimension-qualified key "dim|x,y,z" */
export function dimKey(dim: string, p: V3): string {
  return `${dim}|${p.x},${p.y},${p.z}`;
}
export function parseDimKey(k: string): { dim: string; pos: V3 } {
  const i = k.indexOf('|');
  return { dim: k.slice(0, i), pos: parsePosKey(k.slice(i + 1)) };
}

/** Direction the vector mostly points to */
export function dominantDir(v: V3): Dir {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ay >= ax && ay >= az) return v.y >= 0 ? 'up' : 'down';
  if (ax >= az) return v.x >= 0 ? 'east' : 'west';
  return v.z >= 0 ? 'south' : 'north';
}
export function dominantHorizontal(v: V3): Dir {
  if (Math.abs(v.x) >= Math.abs(v.z)) return v.x >= 0 ? 'east' : 'west';
  return v.z >= 0 ? 'south' : 'north';
}

/** Rotate a horizontal direction clockwise (seen from above) n*90deg */
export function rotateCW(d: Dir, n = 1): Dir {
  const order: Dir[] = ['north', 'east', 'south', 'west'];
  const i = order.indexOf(d);
  if (i < 0) return d;
  return order[(((i + n) % 4) + 4) % 4];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
