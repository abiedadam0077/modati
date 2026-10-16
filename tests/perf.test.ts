// Performance budget checks in the simulated world (V8; Bedrock's QuickJS is slower, see docs/TESTING.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, addPlayer, boot, world, ItemStack, Dimension } from './mock/server';
import '../src/scripts/main';
import { processNetworks, speedOf, markTopologyDirty } from '../src/scripts/kinetics/network';
import { useBeltConnector } from '../src/scripts/logistics/belt';
import { insertAt } from '../src/scripts/logistics/transport';
import { profile } from '../src/scripts/core/scheduler';

boot();
const dim = world.getDimension('minecraft:overworld') as unknown as Dimension;
const player = addPlayer(dim, { x: 0, y: 10, z: 0 });
const v = (x: number, y: number, z: number) => ({ x, y, z });

test('1000-node network: rediscovery + solve stays cheap', () => {
  dim.put(v(-1, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
  for (let x = 0; x < 500; x++) dim.put(v(x, 1, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
  for (let x = 0; x < 500; x += 2) {
    dim.put(v(x, 2, 0), 'craftoria:shaft', { 'craftoria:axis': 'y' });
  }
  advance(5);
  // force a full rediscovery of the big network
  const t0 = performance.now();
  markTopologyDirty(dim.id, v(250, 1, 0));
  processNetworks(100000);
  const ms = performance.now() - t0;
  assert.equal(speedOf(dim.id, v(499, 1, 0)), 16);
  console.log(`rediscover+solve 500-node network: ${ms.toFixed(2)} ms`);
  assert.ok(ms < 150, `took ${ms} ms`);
});

test('20 loaded belts with items: per-tick cost', () => {
  player.inventory.setItem(0, new ItemStack('craftoria:belt_connector', 64));
  player.gameMode = 'Creative' as never;
  for (let i = 0; i < 20; i++) {
    const x = 1000 + i * 3;
    dim.put(v(x - 1, 1, 0), 'craftoria:creative_motor', { 'craftoria:facing': 'east' });
    const a = dim.put(v(x, 1, 0), 'craftoria:shaft', { 'craftoria:axis': 'x' });
    const b = dim.put(v(x, 1, 15), 'craftoria:shaft', { 'craftoria:axis': 'x' });
    useBeltConnector(player as never, a as never);
    useBeltConnector(player as never, b as never);
  }
  advance(10);
  player.teleport(v(1030, 2, 8));
  for (let i = 0; i < 20; i++) for (let k = 0; k < 5; k++) insertAt(dim as never, v(1000 + i * 3, 1, 3 * k), { id: 'minecraft:cobblestone', n: 1 }, 'up');
  const t0 = performance.now();
  advance(100);
  const per = (performance.now() - t0) / 100;
  const belts = profile().find((p) => p.name === 'belts');
  console.log(`20 belts x 5 items: ${per.toFixed(3)} ms per simulated tick (belt task avg ${belts?.avgMs.toFixed(3)} ms)`);
  assert.ok(per < 20);
});
