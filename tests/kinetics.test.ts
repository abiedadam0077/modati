import test from 'node:test';
import assert from 'node:assert/strict';
import { KINETIC_DEFS, ID, States } from '../src/scripts/kinetics/defs';
import { discoverComponent, BlockInfo, nodeKey } from '../src/scripts/kinetics/graph';
import { solveNetwork } from '../src/scripts/kinetics/solver';
import type { GeneratorInput } from '../src/scripts/kinetics/types';
import { V3, posKey } from '../src/scripts/util/vec';

type Cell = { id: string; st: States };
class Grid {
  cells = new Map<string, Cell>();
  set(x: number, y: number, z: number, id: string, st: States = {}) {
    this.cells.set(posKey({ x, y, z }), { id: ID(id), st });
    return this;
  }
  lookup = (p: V3): BlockInfo | undefined => {
    const c = this.cells.get(posKey(p));
    if (!c) return undefined;
    const def = KINETIC_DEFS[c.id];
    if (!def) return undefined;
    return { typeId: c.id, spec: def.spec(c.st) };
  };
  solve(start: V3, gens: Record<string, GeneratorInput>, impacts: Record<string, number> = {}) {
    const comp = discoverComponent(start, null, this.lookup);
    const imp = new Map<string, number>();
    for (const n of comp.nodes) imp.set(n.key, impacts[n.key] ?? n.spec.impact);
    const res = solveNetwork(comp.nodes.map((n) => n.key), comp.edges, imp, new Map(Object.entries(gens)));
    return { comp, res };
  }
}
const k = (x: number, y: number, z: number, sub = '') => nodeKey({ x, y, z }, sub);

test('shaft line carries the same speed', () => {
  const g = new Grid();
  for (let x = 0; x < 5; x++) g.set(x, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  const { res, comp } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 100 } });
  assert.equal(comp.nodes.length, 5);
  assert.equal(res.status, 'running');
  for (let x = 0; x < 5; x++) assert.equal(res.speeds.get(k(x, 0, 0)), 16);
});

test('perpendicular shafts do not connect', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'shaft', { 'craftoria:axis': 'x' }).set(1, 0, 0, 'shaft', { 'craftoria:axis': 'z' });
  const { comp } = g.solve({ x: 0, y: 0, z: 0 }, {});
  assert.equal(comp.nodes.length, 1);
});

test('small cogs mesh with opposite direction', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'cogwheel', { 'craftoria:axis': 'y' }).set(1, 0, 0, 'cogwheel', { 'craftoria:axis': 'y' }).set(1, 0, 1, 'cogwheel', { 'craftoria:axis': 'y' });
  const { res } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 32, capacity: 10 } });
  assert.equal(res.speeds.get(k(1, 0, 0)), -32);
  assert.equal(res.speeds.get(k(1, 0, 1)), 32);
});

test('large to small cog doubles the speed and reverses', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'large_cogwheel', { 'craftoria:axis': 'z' }).set(1, 1, 0, 'cogwheel', { 'craftoria:axis': 'z' });
  const { res } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 } });
  assert.equal(res.speeds.get(k(1, 1, 0)), -32);
  // driven from the small cog instead
  const r2 = g.solve({ x: 1, y: 1, z: 0 }, { [k(1, 1, 0)]: { speed: 64, capacity: 10 } }).res;
  assert.equal(r2.speeds.get(k(0, 0, 0)), -32);
});

test('gearbox redirects and reverses per bevel physics', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'gearbox', { 'craftoria:axis': 'y' });
  g.set(1, 0, 0, 'shaft', { 'craftoria:axis': 'x' }); // +x input
  g.set(-1, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(0, 0, 1, 'shaft', { 'craftoria:axis': 'z' });
  g.set(0, 0, -1, 'shaft', { 'craftoria:axis': 'z' });
  const { res } = g.solve({ x: 1, y: 0, z: 0 }, { [k(1, 0, 0)]: { speed: 10, capacity: 10 } });
  assert.equal(res.speeds.get(k(-1, 0, 0)), -10); // opposite side counter-rotates about +x
  assert.equal(res.speeds.get(k(0, 0, 1)), -10); // matches Create: +z gets -1
  assert.equal(res.speeds.get(k(0, 0, -1)), 10); // -z gets +1
});

test('inconsistent gear loop is a conflict (no block destruction)', () => {
  const g = new Grid();
  // 3 small cogs in an L plus a closing cog -> square loop of 4 is consistent; triangle impossible on grid,
  // so build an inconsistent loop: two cogs meshing AND connected by a shaft path via gearboxes.
  g.set(0, 0, 0, 'cogwheel', { 'craftoria:axis': 'x' });
  g.set(0, 1, 0, 'cogwheel', { 'craftoria:axis': 'x' }); // meshes: ratio -1
  g.set(1, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(1, 1, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(2, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(2, 1, 0, 'shaft', { 'craftoria:axis': 'x' });
  // connect the two shaft lines at x=3 with a vertical chain that preserves direction: cogs (y axis would not
  // connect), use two meshing cogs again -> total loop ratio (-1)*(-1)=+1 consistent. Make it inconsistent with a third pair.
  g.set(3, 0, 0, 'cogwheel', { 'craftoria:axis': 'x' });
  g.set(3, 1, 0, 'cogwheel', { 'craftoria:axis': 'x' });
  const { res } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 100 } });
  // loop: c(0,0)->c(0,1) -1 ; c(0,0)->shaft->c(3,0) +1 -> c(3,1) -1 -> shaft -> c(0,1): -1 both ways => consistent
  assert.equal(res.status, 'running');
  // now break consistency: replace (3,1) with a cog that is reached through a gearshift powered (reverse)
  g.set(2, 1, 0, 'gearshift', { 'craftoria:axis': 'x', 'craftoria:powered': true });
  const r2 = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 100 } }).res;
  assert.equal(r2.status, 'conflict');
  for (const v of r2.speeds.values()) assert.equal(v, 0);
});

test('opposing sources conflict, faster same-direction source dominates', () => {
  const g = new Grid();
  for (let x = 0; x < 4; x++) g.set(x, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  const opp = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 }, [k(3, 0, 0)]: { speed: -16, capacity: 10 } }).res;
  assert.equal(opp.status, 'conflict');
  const same = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 8, capacity: 10 }, [k(3, 0, 0)]: { speed: 32, capacity: 10 } }).res;
  assert.equal(same.status, 'running');
  assert.equal(same.speeds.get(k(1, 0, 0)), 32);
  assert.equal(same.capacity, 8 * 10 + 32 * 10);
});

test('overstress stops the whole network', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'shaft', { 'craftoria:axis': 'y' });
  g.set(0, 1, 0, 'mechanical_press', { 'craftoria:axis': 'y' });
  const ok = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 32, capacity: 8 } }).res; // 256 SU vs 8*32=256
  assert.equal(ok.status, 'running');
  assert.equal(ok.impact, 256);
  const bad = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 32, capacity: 7 } }).res;
  assert.equal(bad.status, 'overstressed');
  assert.equal(bad.speeds.get(k(0, 1, 0)), 0);
});

test('overspeed through gearing is detected', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'large_cogwheel', { 'craftoria:axis': 'z' }).set(1, 1, 0, 'cogwheel', { 'craftoria:axis': 'z' });
  const r = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 200, capacity: 10 } }).res;
  assert.equal(r.status, 'overspeed');
});

test('clutch disconnects when powered, gearshift reverses', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(1, 0, 0, 'clutch', { 'craftoria:axis': 'x', 'craftoria:powered': false });
  g.set(2, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  let r = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 } });
  assert.equal(r.res.speeds.get(k(2, 0, 0)), 16);
  g.set(1, 0, 0, 'clutch', { 'craftoria:axis': 'x', 'craftoria:powered': true });
  r = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 } });
  assert.equal(r.res.speeds.get(k(2, 0, 0)), undefined);
  assert.equal(r.res.speeds.get(k(1, 0, 0, 'a')), 16);
  g.set(1, 0, 0, 'gearshift', { 'craftoria:axis': 'x', 'craftoria:powered': true });
  r = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 } });
  assert.equal(r.res.speeds.get(k(2, 0, 0)), -16);
});

test('belt segments share speed and pulleys connect to shafts', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'shaft', { 'craftoria:axis': 'x' });
  g.set(1, 0, 0, 'belt', { 'craftoria:axis': 'x', 'craftoria:part': 'start' });
  g.set(1, 0, 1, 'belt', { 'craftoria:axis': 'x', 'craftoria:part': 'middle' });
  g.set(1, 0, 2, 'belt', { 'craftoria:axis': 'x', 'craftoria:part': 'end' });
  g.set(2, 0, 2, 'shaft', { 'craftoria:axis': 'x' });
  const { res, comp } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 24, capacity: 10 } });
  assert.equal(comp.nodes.length, 5);
  assert.equal(res.speeds.get(k(2, 0, 2)), 24);
});

test('large cogs with perpendicular axes mesh diagonally', () => {
  const g = new Grid();
  g.set(0, 0, 0, 'large_cogwheel', { 'craftoria:axis': 'x' });
  g.set(1, 1, 0, 'large_cogwheel', { 'craftoria:axis': 'y' });
  const { res, comp } = g.solve({ x: 0, y: 0, z: 0 }, { [k(0, 0, 0)]: { speed: 16, capacity: 10 } });
  assert.equal(comp.nodes.length, 2);
  assert.equal(Math.abs(res.speeds.get(k(1, 1, 0))!), 16);
});
