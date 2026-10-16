// Second batch of end-to-end simulations (fresh mock world).
import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, addPlayer, allEntities, boot, interact, world, ItemStack, Dimension, Player } from './mock/server';
import '../src/scripts/main';
import { speedOf } from '../src/scripts/kinetics/network';
import { insertAt } from '../src/scripts/logistics/transport';
import { depotGet } from '../src/scripts/machines/depot_basin';
import { useGlue } from '../src/scripts/contraptions/contraption';
import { _assembleTrain, _trains } from '../src/scripts/trains/trains';
import { dimKey } from '../src/scripts/util/vec';

boot();
const dim = world.getDimension('minecraft:overworld') as unknown as Dimension;
const player = addPlayer(dim, { x: 0, y: 10, z: 0 });
const v = (x: number, y: number, z: number) => ({ x, y, z });
const near = (x: number, y: number, z: number) => player.teleport(v(x, y, z));
const items = (id: string) => allEntities().filter((e) => e.typeId === 'minecraft:item' && e.itemStack?.typeId === id).reduce((a, e) => a + (e.itemStack?.amount ?? 0), 0);
const hold = (id: string, n = 1) => {
  player.inventory.setItem(0, new ItemStack(id, n));
  player.selectedSlotIndex = 0;
};
function fireUse(block: ReturnType<Dimension['getBlock']>, itemId: string, sneaking: boolean): void {
  player.isSneaking = sneaking;
  (world.beforeEvents.playerInteractWithBlock as unknown as { fire: (e: unknown) => void }).fire({ itemStack: new ItemStack(itemId), player, block, isFirstEvent: true, cancel: false });
  advance(2);
  player.isSneaking = false;
}

test('deployer applies andesite alloy to stripped logs on a depot', () => {
  near(0, 3, 0);
  dim.put(v(-1, 3, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  const dep = dim.put(v(0, 3, 0), 'craftoria:deployer', { 'craftoria:facing': 'down' });
  dim.put(v(0, 1, 0), 'craftoria:depot');
  hold('craftoria:andesite_alloy', 4);
  interact(player, dep);
  assert.equal(player.inventory.count('craftoria:andesite_alloy'), 0, 'deployer took the stack');
  insertAt(dim as never, v(0, 1, 0), { id: 'minecraft:stripped_oak_log', n: 2 }, 'up');
  advance(400);
  const d = depotGet(dimKey(dim.id, v(0, 1, 0)));
  assert.equal(d.items.filter((s) => s.id === 'craftoria:andesite_casing').reduce((a, s) => a + s.n, 0), 2, JSON.stringify(d));
});

test('spout fills a bucket on a depot', () => {
  near(10, 3, 0);
  const sp = dim.put(v(10, 2, 0), 'craftoria:spout');
  dim.put(v(10, 1, 0), 'craftoria:depot');
  hold('minecraft:water_bucket');
  interact(player, sp);
  insertAt(dim as never, v(10, 1, 0), { id: 'minecraft:bucket', n: 1 }, 'up');
  advance(80);
  const d = depotGet(dimKey(dim.id, v(10, 1, 0)));
  assert.deepEqual(d.items.map((s) => s.id), ['minecraft:water_bucket']);
});

test('encased fan washes crushed ore through water', () => {
  near(20, 2, 0);
  dim.put(v(19, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  dim.put(v(20, 1, 0), 'craftoria:encased_fan', { 'craftoria:facing': 'east' });
  dim.put(v(21, 1, 0), 'minecraft:water');
  dim.spawnItem(new ItemStack('craftoria:crushed_raw_iron', 1), v(22.5, 1.2, 0.5));
  advance(200);
  assert.equal(items('minecraft:iron_nugget'), 9);
});

test('chute drops items into a chest; funnels insert and extract', () => {
  near(30, 3, 0);
  dim.put(v(30, 1, 0), 'minecraft:chest');
  dim.put(v(30, 2, 0), 'craftoria:chute');
  assert.equal(insertAt(dim as never, v(30, 2, 0), { id: 'minecraft:coal', n: 7 }, 'up'), 7);
  advance(10);
  assert.equal(dim.getBlock(v(30, 1, 0))!.getComponent('minecraft:inventory')!.container!.count('minecraft:coal'), 7);
  // funnel insert
  dim.put(v(32, 1, 0), 'minecraft:chest');
  dim.put(v(32, 2, 0), 'craftoria:andesite_funnel', { 'craftoria:facing': 'up' });
  dim.spawnItem(new ItemStack('minecraft:apple', 3), v(32.5, 2.6, 0.5));
  advance(10);
  assert.equal(dim.getBlock(v(32, 1, 0))!.getComponent('minecraft:inventory')!.container!.count('minecraft:apple'), 3);
  // funnel extract (toggle with empty hand)
  player.inventory.setItem(0, undefined);
  interact(player, dim.getBlock(v(32, 2, 0))!);
  advance(40);
  assert.ok(items('minecraft:apple') >= 1, 'funnel spits items out in extract mode');
});

test('mechanical arm moves items between chests', () => {
  near(50, 3, 0);
  const a = dim.put(v(52, 1, 0), 'minecraft:chest');
  const b = dim.put(v(48, 1, 0), 'minecraft:chest');
  a.getComponent('minecraft:inventory')!.container!.addItem(new ItemStack('minecraft:iron_ingot', 5));
  fireUse(a, 'craftoria:mechanical_arm', true); // input
  fireUse(b, 'craftoria:mechanical_arm', true); // input
  fireUse(b, 'craftoria:mechanical_arm', true); // -> output
  dim.put(v(50, 0, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'up' });
  const arm = dim.put(v(50, 1, 0), 'craftoria:mechanical_arm');
  (world.afterEvents.playerPlaceBlock as unknown as { fire: (e: unknown) => void }).fire({ block: arm, player });
  advance(400);
  assert.equal(b.getComponent('minecraft:inventory')!.container!.count('minecraft:iron_ingot'), 5);
});

test('hand crank powers while turned, then stops', () => {
  near(60, 2, 0);
  dim.put(v(60, 0, 0), 'craftoria:shaft');
  const crank = dim.put(v(60, 1, 0), 'craftoria:hand_crank', { 'craftoria:facing': 'up' });
  advance(3);
  interact(player, crank);
  advance(4);
  assert.equal(speedOf(dim.id, v(60, 0, 0)), 32);
  advance(40);
  assert.equal(speedOf(dim.id, v(60, 0, 0)), 0);
});

test('clutch disconnects on redstone', () => {
  near(65, 2, 0);
  dim.put(v(64, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  dim.put(v(65, 1, 0), 'craftoria:clutch', { 'craftoria:axis': 'x' });
  dim.put(v(66, 1, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  advance(10);
  assert.equal(speedOf(dim.id, v(66, 1, 0)), 16);
  dim.setPower(v(65, 1, 0), 15);
  advance(10);
  assert.equal(speedOf(dim.id, v(66, 1, 0)), 0);
  dim.setPower(v(65, 1, 0), 0);
  advance(10);
  assert.equal(speedOf(dim.id, v(66, 1, 0)), 16);
});

test('water wheel turns from flowing water', () => {
  near(70, 3, 0);
  dim.put(v(70, 2, 0), 'craftoria:water_wheel', { 'craftoria:axis': 'x' });
  dim.put(v(71, 2, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  dim.put(v(70, 3, -1), 'minecraft:water', { liquid_depth: 0 });
  dim.put(v(70, 3, 0), 'minecraft:flowing_water', { liquid_depth: 1 });
  dim.put(v(70, 3, 1), 'minecraft:flowing_water', { liquid_depth: 2 });
  dim.put(v(69, 3, 0), 'minecraft:stone');
  dim.put(v(71, 3, 0), 'minecraft:stone');
  advance(90);
  assert.equal(Math.abs(speedOf(dim.id, v(71, 2, 0))), 8);
});

test('upward saw cuts logs into planks', () => {
  near(80, 3, 0);
  dim.put(v(79, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  dim.put(v(80, 1, 0), 'craftoria:mechanical_saw', { 'craftoria:facing': 'up' });
  advance(5);
  dim.spawnItem(new ItemStack('minecraft:oak_log', 1), v(80.5, 2.1, 0.5));
  advance(500);
  assert.equal(items('minecraft:oak_planks'), 6);
});

test('rope pulley elevator answers an elevator contact', () => {
  near(90, 6, 0);
  const pulley = dim.put(v(90, 10, 0), 'craftoria:rope_pulley', { 'craftoria:axis': 'x' });
  player.isSneaking = true;
  interact(player, pulley); // elevator mode
  player.isSneaking = false;
  dim.put(v(90, 9, 0), 'minecraft:oak_planks');
  dim.put(v(91, 9, 0), 'minecraft:oak_planks');
  useGlue(player as never, dim.getBlock(v(90, 9, 0)) as never);
  useGlue(player as never, dim.getBlock(v(91, 9, 0)) as never);
  dim.put(v(89, 10, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  advance(20);
  assert.equal(dim.getBlock(v(90, 9, 0))!.typeId, 'minecraft:oak_planks', 'elevator mode: power alone does not move it');
  const contact = dim.put(v(89, 4, 0), 'craftoria:elevator_contact');
  interact(player, contact);
  advance(300);
  assert.equal(dim.getBlock(v(90, 4, 0))!.typeId, 'minecraft:oak_planks');
  assert.equal(dim.getBlock(v(91, 4, 0))!.typeId, 'minecraft:oak_planks');
  assert.equal(dim.getBlock(v(90, 9, 0))!.typeId, 'minecraft:air');
});

test('mechanical piston pushes a glued structure using its poles', () => {
  near(100, 3, 0);
  dim.put(v(99, 1, 0), 'craftoria:piston_pole', { 'craftoria:axis': 'x' });
  dim.put(v(98, 1, 0), 'craftoria:piston_pole', { 'craftoria:axis': 'x' });
  dim.put(v(100, 1, 0), 'craftoria:mechanical_piston', { 'craftoria:facing': 'east' });
  dim.put(v(101, 1, 0), 'minecraft:oak_planks');
  useGlue(player as never, dim.getBlock(v(101, 1, 0)) as never);
  useGlue(player as never, dim.getBlock(v(101, 1, 0)) as never);
  dim.put(v(100, 1, -1), 'craftoria:creative_motor', { 'craftoria:facing': 'south' });
  advance(300);
  assert.equal(dim.getBlock(v(103, 1, 0))!.typeId, 'minecraft:oak_planks');
  assert.equal(dim.getBlock(v(101, 1, 0))!.typeId, 'craftoria:piston_pole');
  assert.equal(dim.getBlock(v(102, 1, 0))!.typeId, 'craftoria:piston_pole');
});

test('train assembles at a station and runs along curved track', () => {
  near(110, 3, 5);
  for (let z = 0; z <= 10; z++) dim.put(v(110, 1, z), 'craftoria:track');
  for (let x = 111; x <= 115; x++) dim.put(v(x, 1, 10), 'craftoria:track');
  assert.equal(dim.getBlock(v(110, 1, 10))!.permutation.getState('craftoria:shape'), 'ne'.length && dim.getBlock(v(110, 1, 10))!.permutation.getState('craftoria:shape'));
  const station = dim.put(v(111, 1, 5), 'craftoria:train_station');
  dim.put(v(110, 2, 5), 'craftoria:train_controls', { 'craftoria:facing': 'south' });
  dim.put(v(110, 2, 4), 'minecraft:oak_planks');
  useGlue(player as never, dim.getBlock(v(110, 2, 4)) as never);
  useGlue(player as never, dim.getBlock(v(110, 2, 5)) as never);
  _assembleTrain(station as never, player as never);
  const t = [..._trains().values()][0];
  assert.ok(t, 'train assembled');
  assert.equal(dim.getBlock(v(110, 2, 5))!.typeId, 'minecraft:air');
  t.auto = true;
  t.autoDir = 1;
  t.station = 'none';
  advance(200);
  const front = t.cells[0].p;
  assert.ok(front.x > 110 || front.z > 7, `train moved along the track (front at ${JSON.stringify(front)})`);
  const disp = allEntities().filter((e) => e.typeId === 'craftoria:block_display' && e.getDynamicProperty('cr:t') === t.id);
  assert.equal(disp.length, 2);
});
