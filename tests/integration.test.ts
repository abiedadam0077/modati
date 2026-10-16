// End-to-end simulations of the real runtime (src/scripts/main.ts) in the mock world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, addPlayer, allEntities, boot, interact, world, ItemStack, Dimension } from './mock/server';
import '../src/scripts/main';
import { speedOf, netOf } from '../src/scripts/kinetics/network';
import { setMotorSpeed } from '../src/scripts/kinetics/generators';
import { insertAt, extractAt } from '../src/scripts/logistics/transport';
import { depotGet, basinGet } from '../src/scripts/machines/depot_basin';
import { useBeltConnector } from '../src/scripts/logistics/belt';
import { useGlue } from '../src/scripts/contraptions/contraption';
import { tankInfo } from '../src/scripts/fluids/fluids';
import { dimKey } from '../src/scripts/util/vec';

boot();
const dim = world.getDimension('minecraft:overworld') as unknown as Dimension;
const player = addPlayer(dim, { x: 0, y: 10, z: 0 });
const v = (x: number, y: number, z: number) => ({ x, y, z });
const near = (x: number, y: number, z: number) => player.teleport(v(x, y, z));

test('kinetic network + rotor visuals', () => {
  near(2, 6, 0);
  dim.put(v(0, 5, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  for (let x = 1; x <= 3; x++) dim.put(v(x, 5, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  dim.put(v(4, 5, 0), 'craftoria:cogwheel', { 'craftoria:axis': 'x' });
  dim.put(v(4, 6, 0), 'craftoria:cogwheel', { 'craftoria:axis': 'x' });
  advance(25);
  assert.equal(speedOf(dim.id, v(2, 5, 0)), 16);
  assert.equal(speedOf(dim.id, v(4, 6, 0)), -16, 'meshing cog turns the other way');
  const net = netOf(dim.id, v(2, 5, 0))!;
  assert.equal(net.status, 'running');
  const rotor = allEntities().find((e) => e.typeId === 'craftoria:rotor' && Math.floor(e.location.x) === 2 && e.location.y === 5);
  assert.ok(rotor, 'rotor spawned near the player');
  assert.equal(rotor!.getProperty('craftoria:speed'), 16);
  assert.equal(rotor!.getProperty('craftoria:dir'), 5, 'axis x rotors orient east');
  assert.equal(dim.getBlock(v(2, 5, 0))!.permutation.getState('craftoria:rotor'), true, 'static shaft hidden while rotor exists');
  const rotorAtPos = (x: number, y: number, z: number) => allEntities().find((e) => e.typeId === 'craftoria:rotor' && Math.floor(e.location.x) === x && e.location.y === y && Math.floor(e.location.z) === z);
  const p1 = rotorAtPos(4, 5, 0)!.getProperty('craftoria:phase') as number;
  const p2 = rotorAtPos(4, 6, 0)!.getProperty('craftoria:phase') as number;
  assert.equal(Math.abs(p1 - p2), 22.5, 'adjacent meshing cogs are offset by half a tooth');
  // break a shaft: downstream stops
  dim.setBlockType(v(2, 5, 0), 'minecraft:air');
  advance(3);
  assert.equal(speedOf(dim.id, v(3, 5, 0)), 0);
  assert.equal(speedOf(dim.id, v(1, 5, 0)), 16);
});

test('mechanical press turns an iron ingot on a depot into a sheet', () => {
  near(10, 4, 0);
  dim.put(v(10, 3, -1), 'craftoria:creative_motor', { 'craftoria:facing': 'south' });
  dim.put(v(10, 3, 0), 'craftoria:mechanical_press', { 'craftoria:axis': 'z' });
  dim.put(v(10, 1, 0), 'craftoria:depot');
  advance(5);
  assert.equal(insertAt(dim as never, v(10, 1, 0), { id: 'minecraft:iron_ingot', n: 2 }, 'up'), 2);
  advance(200);
  const d = depotGet(dimKey(dim.id, v(10, 1, 0)));
  const sheets = d.items.filter((s) => s.id === 'craftoria:iron_sheet').reduce((a, s) => a + s.n, 0);
  assert.equal(sheets, 2, JSON.stringify(d));
  const pressRotor = allEntities().find((e) => e.typeId === 'craftoria:rotor' && Math.floor(e.location.x) === 10 && e.location.y === 3 && Math.floor(e.location.z) === 0);
  assert.ok(pressRotor!.animations.includes('animation.craftoria.rotor.press_cycle'), 'press animation played');
});

test('mechanical mixer makes brass only with heat, needs 30 RPM', () => {
  near(20, 3, 0);
  dim.put(v(20, 4, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'down' });
  dim.put(v(20, 3, 0), 'craftoria:mechanical_mixer');
  dim.put(v(20, 1, 0), 'craftoria:basin');
  insertAt(dim as never, v(20, 1, 0), { id: 'minecraft:copper_ingot', n: 1 }, 'up');
  insertAt(dim as never, v(20, 1, 0), { id: 'craftoria:zinc_ingot', n: 1 }, 'up');
  advance(200);
  assert.equal(basinGet(dimKey(dim.id, v(20, 1, 0))).out.length, 0, 'default 16 RPM is too slow / no heat');
  setMotorSpeed(dim.id, v(20, 4, 0), 32);
  advance(200);
  assert.equal(basinGet(dimKey(dim.id, v(20, 1, 0))).out.length, 0, 'no heat source yet');
  dim.put(v(20, 0, 0), 'minecraft:campfire');
  advance(300);
  const out = basinGet(dimKey(dim.id, v(20, 1, 0))).out;
  assert.deepEqual(out.map((s) => [s.id, s.n]), [['craftoria:brass_ingot', 2]]);
});

test('millstone grinds wheat into flour', () => {
  near(40, 3, 0);
  dim.put(v(40, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'up' });
  dim.put(v(40, 2, 0), 'craftoria:millstone');
  advance(5);
  assert.equal(insertAt(dim as never, v(40, 2, 0), { id: 'minecraft:wheat', n: 3 }, 'up'), 3);
  assert.equal(insertAt(dim as never, v(40, 2, 0), { id: 'minecraft:dirt', n: 1 }, 'up'), 0, 'only millable items accepted');
  advance(600);
  const flour = extractAt(dim as never, v(40, 2, 0), (s) => s.id === 'craftoria:wheat_flour', 64, 'down');
  assert.ok(flour && flour.n >= 3, JSON.stringify(flour));
});

test('belt carries an item into a chest at its end', () => {
  near(30, 2, 2);
  dim.put(v(29, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  const a = dim.put(v(30, 1, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  const b = dim.put(v(30, 1, 4), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  dim.put(v(30, 1, 5), 'minecraft:chest');
  player.inventory.setItem(0, new ItemStack('craftoria:belt_connector', 8));
  player.selectedSlotIndex = 0;
  useBeltConnector(player as never, a as never);
  useBeltConnector(player as never, b as never);
  assert.equal(dim.getBlock(v(30, 1, 2))!.typeId, 'craftoria:belt');
  assert.equal(dim.getBlock(v(30, 1, 0))!.permutation.getState('craftoria:part'), 'start');
  assert.equal(dim.getBlock(v(30, 1, 4))!.permutation.getState('craftoria:part'), 'end');
  assert.equal(player.inventory.count('craftoria:belt_connector'), 5, 'consumed ceil(5/2) belts');
  advance(10);
  assert.equal(speedOf(dim.id, v(30, 1, 2)), 16, 'belt powered through the start pulley');
  assert.equal(insertAt(dim as never, v(30, 1, 0), { id: 'minecraft:iron_ingot', n: 5 }, 'up'), 5);
  advance(260);
  const chest = dim.getBlock(v(30, 1, 5))!.getComponent('minecraft:inventory')!.container!;
  assert.equal(chest.count('minecraft:iron_ingot'), 5);
  assert.ok((dim.getBlock(v(30, 1, 1))!.permutation.getState('craftoria:motion') as number) > 0, 'belt texture animates');
});

test('mechanical drill breaks the block in front', () => {
  near(50, 3, 0);
  dim.put(v(49, 2, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  dim.put(v(50, 2, 0), 'craftoria:mechanical_drill', { 'craftoria:facing': 'east' });
  dim.put(v(51, 2, 0), 'minecraft:stone');
  advance(300);
  assert.equal(dim.getBlock(v(51, 2, 0))!.typeId, 'minecraft:air');
  assert.ok(allEntities().some((e) => e.typeId === 'minecraft:item' && e.itemStack?.typeId === 'minecraft:cobblestone'));
});

test('crushing wheels turning inward crush raw iron', () => {
  near(60, 3, 1);
  dim.put(v(59, 2, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  dim.put(v(60, 2, 0), 'craftoria:crushing_wheel', { 'craftoria:axis': 'x' });
  dim.put(v(60, 2, 2), 'craftoria:crushing_wheel', { 'craftoria:axis': 'x' });
  dim.put(v(61, 2, 2), 'craftoria:creative_motor', { 'craftoria:facing': 'west' });
  advance(10);
  assert.equal(speedOf(dim.id, v(60, 2, 0)), 16);
  assert.equal(speedOf(dim.id, v(60, 2, 2)), -16);
  dim.spawnItem(new ItemStack('minecraft:raw_iron', 2), v(60.5, 2.6, 1.5));
  advance(400);
  const crushed = allEntities().filter((e) => e.typeId === 'minecraft:item' && e.itemStack?.typeId === 'craftoria:crushed_raw_iron');
  assert.ok(crushed.reduce((a, e) => a + (e.itemStack?.amount ?? 0), 0) >= 2);
});

test('bearing in door mode swings a glued structure 90 degrees', () => {
  near(70, 3, 0);
  const bearing = dim.put(v(70, 1, 0), 'craftoria:mechanical_bearing', { 'craftoria:facing': 'up' });
  dim.put(v(70, 2, 0), 'minecraft:oak_planks');
  dim.put(v(71, 2, 0), 'minecraft:oak_planks');
  useGlue(player as never, dim.getBlock(v(70, 2, 0)) as never);
  useGlue(player as never, dim.getBlock(v(71, 2, 0)) as never);
  player.isSneaking = true;
  interact(player, bearing);
  player.isSneaking = false;
  dim.put(v(70, 0, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'up' });
  advance(80);
  assert.equal(dim.getBlock(v(71, 2, 0))!.typeId, 'minecraft:air', 'arm moved away');
  assert.equal(dim.getBlock(v(70, 2, -1))!.typeId, 'minecraft:oak_planks', 'rotated +90 about +Y lands at -Z');
  assert.equal(dim.getBlock(v(70, 2, 0))!.typeId, 'minecraft:oak_planks');
});

test('pump moves water between tanks (direction follows rotation)', () => {
  near(80, 2, 0);
  dim.put(v(79, 1, 0), 'craftoria:fluid_tank');
  dim.put(v(80, 1, 0), 'craftoria:mechanical_pump', { 'craftoria:facing': 'east' });
  dim.put(v(81, 1, 0), 'craftoria:fluid_tank');
  dim.put(v(80, 2, 0), 'craftoria:cogwheel', { 'craftoria:axis': 'x' });
  dim.put(v(79, 2, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  // fill the east tank with 4 buckets
  for (let i = 0; i < 4; i++) {
    player.inventory.setItem(0, new ItemStack('minecraft:water_bucket', 1));
    interact(player, dim.getBlock(v(81, 1, 0))!);
  }
  assert.equal(tankInfo('craftoria:fluid_tank', dimKey(dim.id, v(81, 1, 0)))?.mb, 4000);
  advance(120);
  assert.equal(speedOf(dim.id, v(80, 1, 0)), -16, 'pump meshes with the cog');
  const west = tankInfo('craftoria:fluid_tank', dimKey(dim.id, v(79, 1, 0)));
  assert.ok(west && west.f === 'water' && west.mb > 0, JSON.stringify(west));
});

test('tracks connect into curves automatically', () => {
  near(90, 2, 0);
  dim.put(v(90, 1, 0), 'craftoria:track');
  dim.put(v(90, 1, 1), 'craftoria:track');
  dim.put(v(91, 1, 1), 'craftoria:track');
  const shape = (x: number, z: number) => dim.getBlock(v(x, 1, z))!.permutation.getState('craftoria:shape');
  assert.equal(shape(90, 0), 'ns');
  assert.equal(shape(90, 1), 'ne'.length ? shape(90, 1) : '');
  assert.ok(['ne', 'wn', 'es', 'sw'].includes(shape(90, 1) as string), `corner piece curves (${shape(90, 1)})`);
  assert.equal(shape(91, 1), 'ew');
});

test('persistent stores round-trip through world dynamic properties', async () => {
  const { BlockStore, globalStore, flushAllStores } = await import('../src/scripts/core/store');
  const s = new BlockStore<{ n: number }>('tst');
  s.set('minecraft:overworld|1,2,3', { n: 42 });
  flushAllStores();
  const s2 = new BlockStore<{ n: number }>('tst');
  assert.equal(s2.get('minecraft:overworld|1,2,3')?.n, 42);
  const big = { list: Array.from({ length: 5000 }, (_, i) => `entry-${i}`) };
  globalStore.set('bigtest', big);
  assert.deepEqual(globalStore.get('bigtest'), big);
});
