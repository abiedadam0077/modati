import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockPermutation, Direction, world, addPlayer, Dimension } from './mock/server';
import { beforePlace } from '../src/scripts/blocks/placement';

const dim = world.getDimension('minecraft:overworld') as unknown as Dimension;
const player = addPlayer(dim, { x: 0, y: 5, z: 0 });
function place(id: string, mode: string, at: { x: number; y: number; z: number }, face: Direction, look = { x: 0, y: 0, z: -1 }, sneak = false) {
  player.getViewDirection = () => look;
  player.isSneaking = sneak;
  const e = { block: dim.getBlock(at)!, face, player, permutationToPlace: BlockPermutation.resolve(id), cancel: false };
  beforePlace(e as never, mode);
  return e.permutationToPlace;
}

test('shafts follow the clicked face, cogs copy the axis of a neighbouring cog', () => {
  assert.equal(place('craftoria:shaft', 'axis3', { x: 0, y: 1, z: 0 }, Direction.East).getState('craftoria:axis'), 'x');
  assert.equal(place('craftoria:shaft', 'axis3', { x: 0, y: 1, z: 0 }, Direction.Up).getState('craftoria:axis'), 'y');
  dim.put({ x: 10, y: 1, z: 0 }, 'craftoria:cogwheel', { 'craftoria:axis': 'y' });
  // placing against the east face of that cog (new block at x=11)
  assert.equal(place('craftoria:cogwheel', 'axis3', { x: 11, y: 1, z: 0 }, Direction.East).getState('craftoria:axis'), 'y');
});

test('drills face away from the player, or away from an adjacent power shaft', () => {
  assert.equal(place('craftoria:mechanical_drill', 'facing6', { x: 20, y: 1, z: 0 }, Direction.Up, { x: 0, y: 0, z: -1 }).getState('craftoria:facing'), 'north');
  dim.put({ x: 29, y: 1, z: 0 }, 'craftoria:shaft', { 'craftoria:axis': 'x' });
  assert.equal(place('craftoria:mechanical_drill', 'facing6', { x: 30, y: 1, z: 0 }, Direction.Up, { x: 0, y: 0, z: -1 }).getState('craftoria:facing'), 'east');
});

test('side-shaft machines pick alt so their shafts meet an adjacent shaft', () => {
  // saw facing up (player looks down) with a shaft along Z next to it -> alt = true
  dim.put({ x: 40, y: 1, z: -1 }, 'craftoria:shaft', { 'craftoria:axis': 'z' });
  const p = place('craftoria:mechanical_saw', 'facing6', { x: 40, y: 1, z: 0 }, Direction.Up, { x: 0, y: -1, z: 0 });
  assert.equal(p.getState('craftoria:facing'), 'up');
  assert.equal(p.getState('craftoria:alt'), true);
});

test('presses run their shaft left-right as seen by the player; crank attaches to the clicked face', () => {
  assert.equal(place('craftoria:mechanical_press', 'haxis', { x: 50, y: 2, z: 0 }, Direction.Up, { x: 0, y: 0, z: -1 }).getState('craftoria:axis'), 'x');
  assert.equal(place('craftoria:mechanical_press', 'haxis', { x: 50, y: 2, z: 0 }, Direction.Up, { x: 1, y: 0, z: 0 }).getState('craftoria:axis'), 'z');
  assert.equal(place('craftoria:hand_crank', 'facing6', { x: 60, y: 2, z: 0 }, Direction.South).getState('craftoria:facing'), 'south');
});
