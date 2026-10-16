// Pure unit tests: orientation math, arm kinematics, recipes, content consistency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localAxisSign, orientMatrix, rotorConfig } from '../src/scripts/visuals/rotors';
import { armPose } from '../src/scripts/logistics/arm';
import { wheelsRunInward } from '../src/scripts/machines/grinders';
import { pressCycleTicks } from '../src/scripts/machines/press_mixer';
import { windmillRpm } from '../src/scripts/contraptions/contraption';
import { shapeFor } from '../src/scripts/trains/trains';
import { KINETIC_DEFS, ROTOR, sideAxis, ID } from '../src/scripts/kinetics/defs';
import { MILLING, CRUSHING, MIXING, PRESSING, findBasinRecipe, consumeBasin, rollOutputs } from '../src/scripts/recipes/processing';
import { DIRS, DIR_AXIS, DIR_VEC, Dir } from '../src/scripts/util/vec';
import { hardnessOf } from '../src/scripts/machines/breakers';

test('orientation matrices map local +Y onto every direction', () => {
  for (const d of DIRS) {
    const m = orientMatrix(d);
    const y = [m[1], m[4], m[7]];
    const v = DIR_VEC[d];
    assert.deepEqual(y.map((n) => Math.round(n)), [v.x, v.y, v.z], d);
    assert.equal(localAxisSign(d, 0, 'y', DIR_AXIS[d]), d === 'down' || d === 'north' || d === 'west' ? -1 : 1);
  }
});

test('side-axis rotors (saw / deployer / piston) spin about the shaft axis for every facing', () => {
  for (const f of DIRS) {
    for (const alt of [false, true]) {
      const st = { 'craftoria:facing': f, 'craftoria:alt': alt };
      const cfg = rotorConfig(ID('mechanical_saw'), st, { x: 0, y: 0, z: 0 }, KINETIC_DEFS[ID('mechanical_saw')].rotor!);
      const axis = sideAxis(f, alt);
      assert.notEqual(localAxisSign(cfg.dir, cfg.roll, 'x', axis), 0, `${f}/${alt}: local X lies on ${axis}`);
      assert.equal(Math.abs(cfg.speedSign), 1);
    }
  }
});

test('mechanical arm inverse kinematics reaches the target (forward check)', () => {
  const L1 = 14, L2 = 13;
  for (const o of [{ x: 2, y: 0, z: 0 }, { x: 0, y: -1, z: 3 }, { x: -3, y: 1, z: 2 }, { x: 1, y: 0, z: -1 }]) {
    const surface = 1;
    const p = armPose(o, surface);
    const t1 = (p.lower * Math.PI) / 180, phi = ((p.lower + p.upper) * Math.PI) / 180;
    const fwd = L1 * Math.sin(t1) + L2 * Math.cos(phi);
    const up = 12 + L1 * Math.cos(t1) - L2 * Math.sin(phi) - 6;
    const R = Math.hypot(o.x * 16, o.z * 16);
    const H = (o.y + surface) * 16;
    if (Math.hypot(R, H + 6 - 12) <= L1 + L2) {
      assert.ok(Math.abs(fwd - R) < 0.6, `reach ${fwd} vs ${R}`);
      assert.ok(Math.abs(up - H) < 0.6, `height ${up} vs ${H}`);
    }
    const yaw = (Math.atan2(o.x, o.z) * 180) / Math.PI;
    assert.ok(Math.abs(p.yaw - yaw) < 1e-6);
    assert.ok(Math.abs(p.head + p.lower + p.upper) < 1e-6, 'claw stays vertical');
  }
});

test('crushing wheels must turn inward', () => {
  assert.equal(wheelsRunInward('x', 'south', 16, -16), true);
  assert.equal(wheelsRunInward('x', 'south', -16, 16), false);
  assert.equal(wheelsRunInward('x', 'south', 16, 16), false);
  assert.equal(wheelsRunInward('z', 'east', -16, 16), true);
});

test('Create timing formulas', () => {
  assert.equal(pressCycleTicks(32), 60, 'Create: (int) lerp(32/512, 1, 60) = 4 running ticks per tick -> 240/4');
  assert.ok(pressCycleTicks(256) <= 9);
  assert.equal(windmillRpm(7), 0);
  assert.equal(windmillRpm(8), 1);
  assert.equal(windmillRpm(200), 16);
});

test('track shapes', () => {
  assert.equal(shapeFor('north', 'south'), 'ns');
  assert.equal(shapeFor('east', 'north'), 'ne');
  assert.equal(shapeFor('south', 'west'), 'sw');
});

test('recipes: basin matching and consumption', () => {
  const st = { items: [{ id: 'minecraft:copper_ingot', n: 3 }, { id: 'craftoria:zinc_ingot', n: 1 }], fluids: [] };
  assert.equal(findBasinRecipe(MIXING, st, false), undefined, 'brass needs heat');
  const r = findBasinRecipe(MIXING, st, true)!;
  assert.deepEqual(r.out, [{ id: 'craftoria:brass_ingot', n: 2 }]);
  consumeBasin(r, st);
  assert.deepEqual(st.items, [{ id: 'minecraft:copper_ingot', n: 2 }]);
  const dough = findBasinRecipe(MIXING, { items: [{ id: 'craftoria:wheat_flour', n: 1 }], fluids: [{ f: 'water', mb: 250 }] }, false);
  assert.deepEqual(dough?.out, [{ id: 'craftoria:dough', n: 1 }]);
  const out = rollOutputs(MILLING[0].out, () => 0.99);
  assert.deepEqual(out, [{ id: 'craftoria:wheat_flour', n: 1 }]);
  assert.ok(CRUSHING.length > 20 && PRESSING.length >= 5);
});

test('block hardness table', () => {
  assert.equal(hardnessOf('minecraft:bedrock'), -1);
  assert.equal(hardnessOf('minecraft:obsidian'), 50);
  assert.equal(hardnessOf('minecraft:iron_ore'), 3);
  assert.equal(hardnessOf('minecraft:oak_log'), 2);
});

test('content consistency between runtime definitions and the generated packs', () => {
  const root = process.cwd();
  const bp = path.join(root, 'build/CRAFTORIA_BP');
  const rp = path.join(root, 'build/CRAFTORIA_RP');
  const blocks = new Map<string, Record<string, unknown>>();
  for (const f of fs.readdirSync(path.join(bp, 'blocks'))) {
    const j = JSON.parse(fs.readFileSync(path.join(bp, 'blocks', f), 'utf8'))['minecraft:block'];
    blocks.set(j.description.identifier, j);
  }
  for (const id of Object.keys(KINETIC_DEFS)) {
    assert.ok(blocks.has(id), `${id} exists in the behavior pack`);
    const comps = (blocks.get(id) as { components: Record<string, unknown> }).components;
    assert.ok('craftoria:kinetic' in comps, `${id} has the kinetic component`);
  }
  for (const [id, j] of blocks) {
    const comps = (j as { components: Record<string, unknown> }).components;
    if ('craftoria:kinetic' in comps) assert.ok(id in KINETIC_DEFS, `${id} has a kinetic definition`);
  }
  // rotor model indices
  const rc = JSON.parse(fs.readFileSync(path.join(rp, 'render_controllers/rotor.render_controllers.json'), 'utf8'));
  const geos: string[] = rc.render_controllers['controller.render.craftoria.rotor'].arrays.geometries['Array.geos'];
  for (const [name, idx] of Object.entries(ROTOR)) assert.ok(geos[idx], `rotor model ${name} (${idx}) present`);
  // the client entity declares one geometry per rotor index
  const ce = JSON.parse(fs.readFileSync(path.join(rp, 'entity/rotor.entity.json'), 'utf8'))['minecraft:client_entity'].description;
  assert.equal(Object.keys(ce.geometry).length, Object.keys(ROTOR).length);
  // every recipe output exists
  for (const r of [...MILLING, ...CRUSHING, ...PRESSING]) for (const o of r.out) if (o.id.startsWith('craftoria:')) assert.ok(blocks.has(o.id) || fs.existsSync(path.join(bp, 'items', `${o.id.split(':')[1]}.json`)), o.id);
  void (DIRS as Dir[]);
});
