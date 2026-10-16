// All CRAFTORIA block models (static block geometry) — original designs inspired by the
// industrial copper/brass/andesite look of Create. World-space pixels, origin bottom-center.
// Orientation authoring conventions:
//   axis3   : authored along +Y        (transformation for x:[0,0,90], z:[90,0,0])
//   haxis   : authored along +X        (z: [0,90,0])
//   facing6 : authored "front" = +Y    (north:[-90,0,0] south:[90,0,0] east:[0,0,-90] west:[0,0,90] down:[180,0,0])
//   facing4 : authored front = north   (west:[0,90,0] south:[0,180,0] east:[0,-90,0])
// Bone "moving" holds parts that a rotor entity animates (hidden when craftoria:rotor = true).
import { Model, discY, teethY, ringY, spokesY } from '../lib/model.mjs';
import { shaftY, smallCogY, largeCogY } from './parts.mjs';

function blockModel(name) {
  const m = new Model(name, 'block', { visibleBounds: [2, 2, 0.5] });
  return m;
}

/** Andesite casing cube with plank panels (Create-style "andesite casing" look, own design). */
export function casing(bone, from, to, opts = {}) {
  const frame = opts.frame ?? 'andesite';
  const panel = opts.panel ?? 'wood';
  bone.box(from, to, frame, { detail: { '*': 'rivets' }, ...opts.cube });
  const m = opts.margin ?? 2;
  const e = 0.02;
  const [x0, y0, z0] = from, [x1, y1, z1] = to;
  const faces = opts.faces ?? ['north', 'south', 'east', 'west', 'up', 'down'];
  const P = { planks: true, border: false };
  if (faces.includes('north')) bone.box([x0 + m, y0 + m, z0 - e], [x1 - m, y1 - m, z0], panel, { ...P, hide: ['south', 'up', 'down', 'east', 'west'], grain: { '*': 'u' } });
  if (faces.includes('south')) bone.box([x0 + m, y0 + m, z1], [x1 - m, y1 - m, z1 + e], panel, { ...P, hide: ['north', 'up', 'down', 'east', 'west'], grain: { '*': 'u' } });
  if (faces.includes('west')) bone.box([x0 - e, y0 + m, z0 + m], [x0, y1 - m, z1 - m], panel, { ...P, hide: ['east', 'up', 'down', 'north', 'south'], grain: { '*': 'u' } });
  if (faces.includes('east')) bone.box([x1, y0 + m, z0 + m], [x1 + e, y1 - m, z1 - m], panel, { ...P, hide: ['west', 'up', 'down', 'north', 'south'], grain: { '*': 'u' } });
  if (faces.includes('up')) bone.box([x0 + m, y1, z0 + m], [x1 - m, y1 + e, z1 - m], panel, { ...P, hide: ['down', 'north', 'south', 'east', 'west'], grain: { '*': 'u' } });
  if (faces.includes('down')) bone.box([x0 + m, y0 - e, z0 + m], [x1 - m, y0, z1 - m], panel, { ...P, hide: ['up', 'north', 'south', 'east', 'west'], grain: { '*': 'u' } });
}

/** Square shaft boss (bearing ring) on a face, axis Y at height y (both caps). */
function bossY(bone, y0, y1, r = 3.2, mat = 'andesite_dark') {
  bone.box([-r, y0, -r], [r, y1, r], mat, { detail: { up: 'center_dot', down: 'center_dot' } });
}

// ---------------------------------------------------------------------------
export const BLOCK_MODELS = {
  shaft() {
    const m = blockModel('shaft');
    shaftY(m.bone('moving', { pivot: [0, 8, 0] }));
    return m;
  },
  cogwheel() {
    const m = blockModel('cogwheel');
    smallCogY(m.bone('moving', { pivot: [0, 8, 0] }));
    return m;
  },
  large_cogwheel() {
    const m = blockModel('large_cogwheel');
    largeCogY(m.bone('moving', { pivot: [0, 8, 0] }), { scale: 0.9 });
    return m;
  },
  gearbox() {
    const m = blockModel('gearbox');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 16, 8], { faces: ['up', 'down'] });
    // side frames with shaft holes (bosses)
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (dx) mv.box([dx > 0 ? 6 : -8.6, 6, -2], [dx > 0 ? 8.6 : -6, 10, 2], 'andesite', { detail: { east: 'center_dot', west: 'center_dot' } });
      else mv.box([-2, 6, dz > 0 ? 6 : -8.6], [2, 10, dz > 0 ? 8.6 : -6], 'andesite', { detail: { north: 'center_dot', south: 'center_dot' } });
    }
    return m;
  },
  clutch() { return splitShaftBlock('clutch', 'redstone'); },
  gearshift() { return splitShaftBlock('gearshift', 'brass'); },
  hand_crank() {
    const m = blockModel('hand_crank');
    const s = m.bone('static', { pivot: [0, 0, 0] });
    s.box([-4, 0, -4], [4, 2, 4], 'andesite', { detail: { up: 'rivets' } });
    s.box([-2.5, 2, -2.5], [2.5, 3, 2.5], 'andesite_dark');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    crankParts(mv);
    return m;
  },
  creative_motor() {
    const m = blockModel('creative_motor');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    // mounting base (back) + housing, front = +Y
    s.box([-7, 0, -7], [7, 3, 7], 'steel', { detail: { up: 'bolts', down: 'rivets' } });
    discY(s, 0, 0, 3, 12, 6.2, 'lapis', { steps: 3 });
    for (const y of [4.5, 7.5, 10.5]) discY(s, 0, 0, y - 0.6, y + 0.6, 6.7, 'copper', { steps: 3 });
    s.box([-4, 12, -4], [4, 13.5, 4], 'steel', { detail: { up: 'bolts' } });
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    shaftY(mv, 13.5, 16, { noBands: true });
    return m;
  },
  water_wheel() {
    const m = blockModel('water_wheel');
    waterWheelParts(m.bone('moving', { pivot: [0, 8, 0] }), 0.93);
    return m;
  },
  windmill_bearing() { return bearingBlock('windmill_bearing', 'wood_dark', 'brass'); },
  mechanical_bearing() { return bearingBlock('mechanical_bearing', 'wood', 'andesite'); },
  mechanical_press() {
    const m = blockModel('mechanical_press');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    // housing with the shaft running along X through the block center (y = 8)
    casing(s, [-8, 4, -8], [8, 16, 8], { faces: ['north', 'south', 'up'], margin: 2 });
    s.box([-8.01, 4, -8.01], [8.01, 5.5, 8.01], 'iron', { hide: ['up'] });
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    mv.box([-8.6, 6, -2], [8.6, 10, 2], 'andesite', { detail: { east: 'center_dot', west: 'center_dot' }, grain: { '*': 'u' } });
    pressHead(mv, 1.5);
    return m;
  },
  mechanical_mixer() {
    const m = blockModel('mechanical_mixer');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-7, 12, -7], [7, 16, 7], { faces: ['north', 'south', 'east', 'west', 'up'], margin: 1 });
    s.box([-3, 3, -3], [3, 6, 3], 'steel');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    // cog ring around the middle
    discY(mv, 0, 0, 7, 11, 5.8, 'wood', { steps: 3 });
    teethY(mv, 0, 0, 7.01, 10.99, 5, 8, 8, 2.6, 'wood_dark');
    mixerWhisk(mv, 6);
    return m;
  },
  millstone() {
    const m = blockModel('millstone');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 6, 8], 'stone', { detail: { '*': 'rivets' } });
    s.box([-8.01, 4, -8.01], [8.01, 5, 8.01], 'andesite', { hide: ['up', 'down'] });
    s.box([-7, 13, -7], [7, 14, -5], 'iron');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    discY(mv, 0, 0, 6, 9, 7.5, 'wood', { steps: 3 });
    teethY(mv, 0, 0, 6.01, 8.99, 6.5, 8.2, 8, 2.4, 'wood_dark');
    discY(mv, 0, 0, 9, 15, 6.8, 'granite', { steps: 3, cube: { detail: { up: 'center_dot' } } });
    mv.box([-1, 15, -1], [1, 16, 1], 'iron');
    return m;
  },
  crushing_wheel() {
    const m = blockModel('crushing_wheel');
    crushingWheelParts(m.bone('moving', { pivot: [0, 8, 0] }), 0.94);
    return m;
  },
  mechanical_drill() {
    const m = blockModel('mechanical_drill');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 8, 8], { faces: ['north', 'south', 'east', 'west'], margin: 1.5 });
    s.box([-7, 8, -7], [7, 9, 7], 'iron');
    drillHead(m.bone('moving', { pivot: [0, 8, 0] }));
    return m;
  },
  mechanical_saw() {
    const m = blockModel('mechanical_saw');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 9, 8], { faces: ['north', 'south', 'east', 'west', 'down'], margin: 1.5 });
    // top plate with blade slot
    s.box([-8, 9, -8], [-1.2, 10, 8], 'iron');
    s.box([1.2, 9, -8], [8, 10, 8], 'iron');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    sawBlade(mv);
    // side shaft stubs along X (alt = false)
    mv.box([-8.5, 3, -2], [-6, 7, 2], 'andesite', { detail: { west: 'center_dot' } });
    mv.box([6, 3, -2], [8.5, 7, 2], 'andesite', { detail: { east: 'center_dot' } });
    // alt variant: blade turned 90deg, stubs along Z
    const alt = m.bone('moving_alt', { pivot: [0, 8, 0], rotation: { axis: 'y', angle: 90 } });
    sawBlade(alt);
    alt.box([-8.5, 3, -2], [-6, 7, 2], 'andesite', { detail: { west: 'center_dot' } });
    alt.box([6, 3, -2], [8.5, 7, 2], 'andesite', { detail: { east: 'center_dot' } });
    return m;
  },
  deployer() {
    const m = blockModel('deployer');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 12, 8], { faces: ['north', 'south', 'down'], margin: 2 });
    s.box([-8.01, 2, -8.01], [8.01, 4, 8.01], 'brass', { hide: ['up', 'down'] });
    s.box([-5, 12, -5], [5, 13, 5], 'brass_dark');
    const hand = m.bone('hand', { pivot: [0, 8, 0] });
    deployerHand(hand, 0);
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    mv.box([-8.5, 4, -2], [-6, 8, 2], 'andesite', { detail: { west: 'center_dot' } });
    mv.box([6, 4, -2], [8.5, 8, 2], 'andesite', { detail: { east: 'center_dot' } });
    const alt = m.bone('moving_alt', { pivot: [0, 8, 0] });
    alt.box([-2, 4, -8.5], [2, 8, -6], 'andesite', { detail: { north: 'center_dot' } });
    alt.box([-2, 4, 6], [2, 8, 8.5], 'andesite', { detail: { south: 'center_dot' } });
    return m;
  },
  mechanical_arm() {
    const m = blockModel('mechanical_arm');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 3, 8], 'brass', { detail: { '*': 'rivets' } });
    s.box([-6, 3, -6], [6, 5, 6], 'andesite');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    discY(mv, 0, 0, 5, 8, 6.4, 'wood', { steps: 3 });
    teethY(mv, 0, 0, 5.01, 7.99, 5.6, 8, 8, 2.4, 'wood_dark');
    armParts(mv, true);
    return m;
  },
  encased_fan() {
    const m = blockModel('encased_fan');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    // ring frame open at front (+Y)
    s.box([-8, 0, -8], [8, 4, 8], 'andesite', { detail: { '*': 'rivets' } });
    s.box([-8, 4, -8], [-6, 16, 8], 'andesite');
    s.box([6, 4, -8], [8, 16, 8], 'andesite');
    s.box([-6, 4, -8], [6, 16, -6], 'andesite');
    s.box([-6, 4, 6], [6, 16, 8], 'andesite');
    s.box([-6, 14.5, -0.75], [6, 15.5, 0.75], 'iron');
    s.box([-0.75, 14.5, -6], [0.75, 15.5, 6], 'iron');
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    propeller(mv);
    return m;
  },
  mechanical_pump() {
    const m = blockModel('mechanical_pump');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-4, 0, -4], [4, 16, 4], 'copper', { hide: [], detail: { up: 'dark_center', down: 'dark_center' } });
    s.box([-5, 0, -5], [5, 2, 5], 'copper', { detail: { '*': 'bolts' } });
    s.box([-5, 14, -5], [5, 16, 5], 'copper', { detail: { '*': 'bolts' } });
    s.box([-4.5, 11, -1], [-4, 13, 1], 'brass', { hide: ['east'] });
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    discY(mv, 0, 0, 6, 10, 6, 'wood', { steps: 3 });
    teethY(mv, 0, 0, 6.01, 9.99, 5.2, 8, 8, 2.6, 'wood_dark');
    return m;
  },
  rope_pulley() {
    const m = blockModel('rope_pulley');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 16, 8], { faces: ['north', 'south', 'up'], margin: 2 });
    s.box([-3, -0.02, -3], [3, 0, 3], 'dark', { hide: ['up', 'north', 'south', 'east', 'west'] });
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    mv.box([-8.6, 6, -2], [8.6, 10, 2], 'andesite', { detail: { east: 'center_dot', west: 'center_dot' }, grain: { '*': 'u' } });
    return m;
  },
  mechanical_piston() {
    const m = blockModel('mechanical_piston');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 12, 8], { faces: ['north', 'south', 'down'], margin: 2 });
    s.box([-8, 12, -8], [8, 16, 8], 'wood', { planks: true, detail: { up: 'rivets' } });
    s.box([-2, 15.9, -2], [2, 16.05, 2], 'iron', { hide: ['down'] });
    const mv = m.bone('moving', { pivot: [0, 8, 0] });
    mv.box([-8.5, 4, -2], [-6, 8, 2], 'andesite', { detail: { west: 'center_dot' } });
    mv.box([6, 4, -2], [8.5, 8, 2], 'andesite', { detail: { east: 'center_dot' } });
    const alt = m.bone('moving_alt', { pivot: [0, 8, 0] });
    alt.box([-2, 4, -8.5], [2, 8, -6], 'andesite', { detail: { north: 'center_dot' } });
    alt.box([-2, 4, 6], [2, 8, 8.5], 'andesite', { detail: { south: 'center_dot' } });
    return m;
  },
  piston_pole() {
    const m = blockModel('piston_pole');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-2, 0, -2], [2, 16, 2], 'wood', { grain: { '*': 'v' } });
    s.box([-2.5, 7, -2.5], [2.5, 9, 2.5], 'iron');
    return m;
  },
  speedometer() { return gaugeBlock('speedometer', 'lapis'); },
  stressometer() { return gaugeBlock('stressometer', 'redstone'); },
  belt() { return beltBlock(); },
  basin() {
    const m = blockModel('basin');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 2, 8], 'andesite', { detail: { down: 'rivets' } });
    s.box([-8, 2, -8], [8, 14, -6], 'andesite', { detail: { north: 'rivets' } });
    s.box([-8, 2, 6], [8, 14, 8], 'andesite', { detail: { south: 'rivets' } });
    s.box([-8, 2, -6], [-6, 14, 6], 'andesite', { detail: { west: 'rivets' } });
    s.box([6, 2, -6], [8, 14, 6], 'andesite', { detail: { east: 'rivets' } });
    s.box([-6, 2, -6], [6, 2.05, 6], 'dark', { hide: ['down', 'north', 'south', 'east', 'west'] });
    s.box([-8.2, 12, -8.2], [8.2, 13, 8.2], 'iron', { hide: ['up', 'down'] });
    // fluid level layer (shown via bone visibility when fluid present)
    const f = m.bone('fluid', { pivot: [0, 8, 0] });
    f.box([-6, 2, -6], [6, 9, 6], 'water', { hide: ['down', 'north', 'south', 'east', 'west'] });
    return m;
  },
  depot() {
    const m = blockModel('depot');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 9, 8], 'andesite', { detail: { '*': 'rivets' } });
    s.box([-7, 9, -7], [7, 11, 7], 'brass', { detail: { up: 'dark_center' } });
    s.box([-8.01, 3, -8.01], [8.01, 5, 8.01], 'wood', { hide: ['up', 'down'], planks: true });
    return m;
  },
  chute() {
    const m = blockModel('chute');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-6, 0, -6], [6, 16, -4], 'iron', { detail: { north: 'rivets' } });
    s.box([-6, 0, 4], [6, 16, 6], 'iron', { detail: { south: 'rivets' } });
    s.box([-6, 0, -4], [-4, 16, 4], 'iron', { detail: { west: 'rivets' } });
    s.box([4, 0, -4], [6, 16, 4], 'iron', { detail: { east: 'rivets' } });
    s.box([-7, 13, -7], [7, 16, 7], 'brass', { hide: ['up', 'down'] });
    s.box([-7, 0, -7], [7, 2, 7], 'brass', { hide: ['up', 'down'] });
    s.box([-4, 7.9, -4], [4, 8.1, 4], 'dark', { hide: ['north', 'south', 'east', 'west'] });
    return m;
  },
  andesite_funnel() { return funnelBlock('andesite_funnel', 'andesite'); },
  brass_funnel() { return funnelBlock('brass_funnel', 'brass'); },
  fluid_pipe() {
    const m = blockModel('fluid_pipe');
    const c = m.bone('core', { pivot: [0, 8, 0] });
    c.box([-4, 4, -4], [4, 12, 4], 'copper', { detail: { '*': 'bolts' } });
    const conn = { up: [[-3, 12, -3], [3, 16, 3]], down: [[-3, 0, -3], [3, 4, 3]], north: [[-3, 5, -8], [3, 11, -4]], south: [[-3, 5, 4], [3, 11, 8]], west: [[-8, 5, -3], [-4, 11, 3]], east: [[4, 5, -3], [8, 11, 3]] };
    for (const [d, [a, b]] of Object.entries(conn)) {
      const bn = m.bone(`c_${d}`, { pivot: [0, 8, 0] });
      bn.box(a, b, 'copper', { hide: [d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'north' ? 'south' : d === 'south' ? 'north' : d === 'west' ? 'east' : 'west'], detail: { [d]: 'dark_center' } });
    }
    return m;
  },
  fluid_tank() {
    const m = blockModel('fluid_tank');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 2, 8], 'copper', { detail: { '*': 'bolts' } });
    s.box([-8, 14, -8], [8, 16, 8], 'copper', { detail: { '*': 'bolts' } });
    for (const [x, z] of [[-8, -8], [6, -8], [-8, 6], [6, 6]]) s.box([x, 2, z], [x + 2, 14, z + 2], 'copper');
    // glass walls
    s.box([-6, 2, -7.5], [6, 14, -7], 'glass', { hide: ['up', 'down'] });
    s.box([-6, 2, 7], [6, 14, 7.5], 'glass', { hide: ['up', 'down'] });
    s.box([-7.5, 2, -6], [-7, 14, 6], 'glass', { hide: ['up', 'down'] });
    s.box([7, 2, -6], [7.5, 14, 6], 'glass', { hide: ['up', 'down'] });
    for (let i = 1; i <= 4; i++) {
      const lv = m.bone(`level${i}`, { pivot: [0, 8, 0] });
      lv.box([-6.8, 2 + (i - 1) * 3, -6.8], [6.8, 2 + i * 3, 6.8], 'water', { hide: i < 4 ? ['up', 'down'] : ['down'] });
    }
    return m;
  },
  spout() {
    const m = blockModel('spout');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-6, 8, -6], [6, 16, 6], 'copper', { detail: { '*': 'bolts' } });
    s.box([-7, 14, -7], [7, 16, 7], 'copper', { hide: ['down'] });
    s.box([-4, 4, -4], [4, 8, 4], 'copper');
    s.box([-2, 1, -2], [2, 4, 2], 'brass', { detail: { down: 'dark_center' } });
    return m;
  },
  sail() { return sailBlock('sail', true); },
  sail_frame() { return sailBlock('sail_frame', false); },
  track() { return trackBlock(); },
  train_station() {
    const m = blockModel('train_station');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 12, 8], { frame: 'brass', panel: 'wood_dark', faces: ['north', 'south', 'east', 'west'] });
    s.box([-7, 12, -7], [7, 14, 7], 'steel', { detail: { up: 'hazard' } });
    s.box([-1, 14, -1], [1, 20, 1], 'iron');
    s.box([-4, 18, -0.5], [4, 22, 0.5], 'lapis', { detail: { north: 'arrow_u', south: 'arrow_u' } });
    return m;
  },
  train_signal() {
    const m = blockModel('train_signal');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-3, 0, -3], [3, 2, 3], 'steel');
    s.box([-1, 2, -1], [1, 14, 1], 'iron');
    s.box([-2.5, 9, -2.5], [2.5, 16, 2.5], 'steel', { detail: { '*': 'bolts' } });
    const g = m.bone('lamp_green', { pivot: [0, 8, 0] });
    g.box([-1.5, 10, -2.6], [1.5, 12, 2.6], 'copper_patina', { hide: ['up', 'down', 'east', 'west'] });
    const r = m.bone('lamp_red', { pivot: [0, 8, 0] });
    r.box([-1.5, 13, -2.6], [1.5, 15, 2.6], 'redstone', { hide: ['up', 'down', 'east', 'west'] });
    return m;
  },
  train_controls() {
    const m = blockModel('train_controls');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 8, 8], 'brass', { detail: { '*': 'rivets' } });
    s.box([-7, 8, -7], [7, 10, 1], 'wood_dark', { planks: true });
    s.box([-5, 10, -6], [-3, 15, -4], 'iron');
    s.box([-5.5, 15, -6.5], [-2.5, 17, -3.5], 'redstone');
    s.box([2, 10, -6], [4, 14, -4], 'iron');
    s.box([1.5, 14, -6.5], [4.5, 16, -3.5], 'lapis');
    s.box([-3, 10, 1], [3, 14, 2], 'glass');
    return m;
  },
  seat() {
    const m = blockModel('seat');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    s.box([-8, 0, -8], [8, 5, 8], 'wood', { planks: true });
    s.box([-7, 5, -7], [7, 8, 7], 'redstone', { border: false });
    return m;
  },
  elevator_contact() {
    const m = blockModel('elevator_contact');
    const s = m.bone('static', { pivot: [0, 8, 0] });
    casing(s, [-8, 0, -8], [8, 16, 8], { frame: 'brass', panel: 'steel' });
    const on = m.bone('lamp', { pivot: [0, 8, 0] });
    for (const f of ['north', 'south', 'east', 'west']) {
      const map = { north: [[-2, 6, -8.1], [2, 10, -8]], south: [[-2, 6, 8], [2, 10, 8.1]], west: [[-8.1, 6, -2], [-8, 10, 2]], east: [[8, 6, -2], [8.1, 10, 2]] }[f];
      on.box(map[0], map[1], 'gold', { border: false });
    }
    return m;
  },
};

// ---------------------------------------------------------------------------
// shared part builders (also used by rotor models)

export function crankParts(bone) {
  shaftY(bone, 2, 9, { noBands: true, r: 1.5 });
  bone.box([-1.5, 8, -1.5], [9, 10, 1.5], 'wood_dark', { grain: { '*': 'u' } });
  bone.box([6.5, 10, -1.5], [9.5, 15, 1.5], 'wood', { grain: { '*': 'v' } });
  bone.box([6, 14, -2], [10, 16, 2], 'brass');
}

export function waterWheelParts(bone, k = 1) {
  const R = 14 * k;
  ringY(bone, 0, 0, 3, 13, R - 1, 2.2, 12, 'wood', { cube: { grain: { '*': 'v' } } });
  spokesY(bone, 0, 0, 6, 10, 2, R - 2.5, 4, 2, 'wood_dark', { phase: 0 });
  spokesY(bone, 0, 0, 6, 10, 2, R - 2.5, 4, 2, 'wood_dark', { phase: 45 });
  // paddles
  for (let i = 0; i < 8; i++) {
    bone.box([R - 3.5, 2, -0.75], [R + 1.4, 14, 0.75], 'wood_light', { rot: { axis: 'y', angle: i * 45 + 22.5, pivot: [0, 8, 0] }, grain: { '*': 'v' }, planks: true });
  }
  discY(bone, 0, 0, 2, 14, 3.4, 'andesite', { steps: 2 });
  shaftY(bone, 0, 16, { noBands: true });
}

export function crushingWheelParts(bone, k = 1) {
  const R = 15.6 * k;
  discY(bone, 0, 0, 1, 15, R - 1.5, 'granite', { steps: 4 });
  teethY(bone, 0, 0, 1.2, 14.8, R - 2.5, R, 24, 2, 'stone', { phase: 7.5 });
  discY(bone, 0, 0, 0.4, 15.6, 5, 'andesite', { steps: 2 });
  discY(bone, 0, 0, 0, 16, 3, 'andesite_dark', { steps: 1 });
}

export function pressHead(bone, dy = 0) {
  // rod + heavy head plate (head bottom at y = 0 at rest, travels down during pressing)
  bone.box([-1.5, 1 + dy, -1.5], [1.5, 6 + dy, 1.5], 'iron', { grain: { '*': 'v' } });
  bone.box([-6, -0.5 + dy, -6], [6, 2 + dy, 6], 'steel', { detail: { up: 'bolts', down: 'grate' } });
  bone.box([-6.5, -1 + dy, -6.5], [6.5, -0.5 + dy, 6.5], 'iron');
}

export function mixerWhisk(bone, dy = 0) {
  bone.box([-1, 0 + dy, -1], [1, 7 + dy, 1], 'iron', { grain: { '*': 'v' } });
  for (let i = 0; i < 4; i++) {
    bone.box([1, -3 + dy, -0.5], [4.5, 2 + dy, 0.5], 'iron', { rot: { axis: 'y', angle: i * 90, pivot: [0, 0, 0] } });
    bone.box([3.5, -6 + dy, -0.5], [4.5, -3 + dy, 0.5], 'iron', { rot: { axis: 'y', angle: i * 90, pivot: [0, 0, 0] } });
  }
  bone.box([-4.5, -7 + dy, -0.5], [4.5, -6 + dy, 0.5], 'iron');
  bone.box([-0.5, -7 + dy, -4.5], [0.5, -6 + dy, 4.5], 'iron');
}

export function drillHead(bone) {
  shaftY(bone, 8, 10, { noBands: true, r: 2.5 });
  bone.box([-5, 9, -5], [5, 11, 5], 'iron', { detail: { '*': 'bolts' } });
  bone.box([-4, 11, -4], [4, 13, 4], 'iron');
  bone.box([-3, 13, -3], [3, 15, 3], 'iron');
  bone.box([-2, 15, -2], [2, 17, 2], 'iron');
  bone.box([-1, 17, -1], [1, 18.5, 1], 'iron');
  // spiral flutes
  for (let i = 0; i < 4; i++) bone.box([2.5, 11, -0.5], [5, 15.5, 0.5], 'steel', { rot: { axis: 'y', angle: i * 90 + 20, pivot: [0, 8, 0] } });
}

export function sawBlade(bone) {
  // blade disc in the YZ plane around (0,9,0): built as an X-axis disc using rotated boxes about X
  const cy = 9;
  for (let k = 0; k < 3; k++) {
    bone.box([-0.5, cy - 6, -6], [0.5, cy + 6, 6], 'iron', { rot: k ? { axis: 'x', angle: k * 30, pivot: [0, cy, 0] } : undefined, variant: k });
  }
  for (let i = 0; i < 12; i++) {
    bone.box([-0.6, cy + 5.5, -1], [0.6, cy + 8, 1], 'steel', { rot: { axis: 'x', angle: i * 30, pivot: [0, cy, 0] } });
  }
  bone.box([-1, cy - 1.5, -1.5], [1, cy + 1.5, 1.5], 'brass');
}

export function deployerHand(bone, dy = 0) {
  bone.box([-1.5, 12 + dy, -1.5], [1.5, 15 + dy, 1.5], 'iron');
  bone.box([-4, 14 + dy, -2], [4, 16 + dy, 2], 'brass', { detail: { up: 'bolts' } });
  bone.box([-4, 16 + dy, -2], [-2.5, 19 + dy, 2], 'brass');
  bone.box([2.5, 16 + dy, -2], [4, 19 + dy, 2], 'brass');
  bone.box([-1, 16 + dy, -2.5], [1, 18 + dy, -1.5], 'brass_dark');
}

export function armParts(bone, compact) {
  // static (folded) arm used in block model; rotor uses articulated bones
  bone.box([-3, 8, -3], [3, 11, 3], 'brass');
  bone.box([-1.5, 11, -1.5], [1.5, 20, 1.5], 'brass', { grain: { '*': 'v' } });
  bone.box([-2, 19, -2], [2, 22, 8], 'brass', { grain: { '*': 'u' } });
  bone.box([-2.5, 18, 7], [2.5, 20, 10], 'andesite_dark');
  if (!compact) bone.box([-1, 16, 8], [1, 18, 10], 'iron');
}

export function propeller(bone) {
  bone.box([-1.5, 6, -1.5], [1.5, 14, 1.5], 'andesite');
  for (let i = 0; i < 4; i++) {
    bone.box([1, 11, -1.8], [6.5, 12, 1.8], 'wood_light', { rot: { axis: 'y', angle: i * 90 + 15, pivot: [0, 11.5, 0] } });
  }
  bone.box([-2, 12, -2], [2, 13, 2], 'brass');
}

function splitShaftBlock(name, accent) {
  const m = blockModel(name);
  const s = m.bone('static', { pivot: [0, 8, 0] });
  casing(s, [-6, 3, -6], [6, 13, 6], { margin: 1.5 });
  s.box([-6.5, 7, -6.5], [6.5, 9, 6.5], accent, { hide: ['up', 'down'] });
  const lamp = m.bone('lamp', { pivot: [0, 8, 0] });
  lamp.box([-1.5, 7.2, -6.7], [1.5, 8.8, 6.7], 'gold', { hide: ['up', 'down'], border: false });
  const mv = m.bone('moving', { pivot: [0, 8, 0] });
  shaftY(mv, 0, 3.2, { noBands: true });
  shaftY(mv, 12.8, 16, { noBands: true });
  return m;
}

function bearingBlock(name, topMat, frame) {
  const m = blockModel(name);
  const s = m.bone('static', { pivot: [0, 8, 0] });
  casing(s, [-8, 0, -8], [8, 12, 8], { frame, faces: ['north', 'south', 'east', 'west', 'down'] });
  const mv = m.bone('moving', { pivot: [0, 8, 0] });
  mv.box([-7, 12, -7], [7, 16, 7], topMat, { planks: true, detail: { up: 'rivets' } });
  mv.box([-3, 15.9, -3], [3, 16.1, 3], frame === 'brass' ? 'brass' : 'iron', { hide: ['down'] });
  return m;
}

function gaugeBlock(name, accent) {
  const m = blockModel(name);
  const s = m.bone('static', { pivot: [0, 8, 0] });
  // gauge casing around a Y shaft with 4 dial faces
  s.box([-6, 2, -6], [6, 14, 6], 'andesite', { detail: { up: 'rivets', down: 'rivets' } });
  for (const [f, a, b] of [['north', [-5, 3, -6.2], [5, 13, -6]], ['south', [-5, 3, 6], [5, 13, 6.2]], ['west', [-6.2, 3, -5], [-6, 13, 5]], ['east', [6, 3, -5], [6.2, 13, 5]]]) {
    s.box(a, b, 'white', { hide: ['up', 'down'], border: true });
    void f;
  }
  s.box([-6.5, 12, -6.5], [6.5, 13, 6.5], accent, { hide: ['up', 'down'] });
  const mv = m.bone('moving', { pivot: [0, 8, 0] });
  shaftY(mv, 0, 2.2, { noBands: true });
  shaftY(mv, 13.8, 16, { noBands: true });
  return m;
}

function beltBlock() {
  const m = blockModel('belt');
  // run along Z (pulley axis X). surface y 3..13, x 1..15
  const body = m.bone('body', { pivot: [0, 8, 0] });
  // belt sides (rubber)
  body.box([-7, 3, -8], [7, 13, 8], 'rubber', {
    hide: ['north', 'south'],
    external: { up: { instance: 'belt', uv: [0, 0], size: [14, 16] }, down: { instance: 'belt', uv: [0, 0], size: [14, 16] } },
  });
  // casing rails (andesite) along both sides
  const rails = m.bone('rails', { pivot: [0, 8, 0] });
  rails.box([-8, 4, -8], [-7, 12, 8], 'andesite', { hide: ['north', 'south'] });
  rails.box([7, 4, -8], [8, 12, 8], 'andesite', { hide: ['north', 'south'] });
  // pulley caps for start (north end) / end (south end)
  for (const [name, z0, z1] of [['cap_start', -8, -4], ['cap_end', 4, 8]]) {
    const b = m.bone(name, { pivot: [0, 8, 0] });
    b.box([-8.5, 5, z0], [8.5, 11, z1], 'andesite', { detail: { east: 'center_dot', west: 'center_dot' } });
  }
  // roller ends (visible when no rotor)
  const mv = m.bone('moving', { pivot: [0, 8, 0] });
  mv.box([-8.6, 6, -2], [8.6, 10, 2], 'andesite', { grain: { '*': 'u' } });
  return m;
}

function funnelBlock(name, mat) {
  // authored facing +Y (output side of the funnel mouth pointing away from the attached block)
  const m = blockModel(name);
  const s = m.bone('static', { pivot: [0, 8, 0] });
  s.box([-8, 0, -8], [8, 3, 8], mat, { detail: { '*': 'rivets' } });
  s.box([-7, 3, -7], [7, 5, -5], mat);
  s.box([-7, 3, 5], [7, 5, 7], mat);
  s.box([-7, 3, -5], [-5, 5, 5], mat);
  s.box([5, 3, -5], [7, 5, 5], mat);
  s.box([-5, 2.95, -5], [5, 3.05, 5], 'dark', { hide: ['north', 'south', 'east', 'west'] });
  s.box([-6, 5, -6], [6, 6, -4.5], 'iron');
  s.box([-6, 5, 4.5], [6, 6, 6], 'iron');
  const lit = m.bone('lamp', { pivot: [0, 8, 0] });
  lit.box([-1.5, 3, -8.1], [1.5, 4.5, 8.1], 'gold', { hide: ['up', 'down', 'east', 'west'], border: false });
  return m;
}

function sailBlock(name, cloth) {
  // authored facing +Y: thin panel lying in XZ plane at y 6..8? -> panel at y 7..9
  const m = blockModel(name);
  const s = m.bone('static', { pivot: [0, 8, 0] });
  s.box([-8, 7, -8], [8, 9, -6.5], 'wood', { grain: { '*': 'u' } });
  s.box([-8, 7, 6.5], [8, 9, 8], 'wood', { grain: { '*': 'u' } });
  s.box([-8, 7, -6.5], [-6.5, 9, 6.5], 'wood', { grain: { '*': 'v' } });
  s.box([6.5, 7, -6.5], [8, 9, 6.5], 'wood', { grain: { '*': 'v' } });
  s.box([-0.75, 7.2, -6.5], [0.75, 8.8, 6.5], 'wood_dark');
  if (cloth) s.box([-6.5, 7.6, -6.5], [6.5, 8.4, 6.5], 'canvas', { border: false });
  return m;
}

function trackBlock() {
  // straight track along Z; curves via bone visibility
  const m = blockModel('track');
  const st = m.bone('straight', { pivot: [0, 8, 0] });
  for (let z = -7; z <= 5; z += 4) st.box([-7, 0, z], [7, 1.5, z + 2], 'wood_dark', { grain: { '*': 'u' } });
  st.box([-5, 1.5, -8], [-3.5, 3, 8], 'track_rail', { grain: { '*': 'v' } });
  st.box([3.5, 1.5, -8], [5, 3, 8], 'track_rail', { grain: { '*': 'v' } });
  // curve (north edge -> east edge): quarter circles centered on the north-east corner (8,-8)
  const cv = m.bone('curve', { pivot: [0, 8, 0] });
  for (let i = 0; i < 4; i++) {
    const a = 11.25 + i * 22.5;
    cv.box([-7, 0, -9], [7, 1.5, -7], 'wood_dark', { rot: { axis: 'y', angle: a, pivot: [8, 0.75, -8] }, grain: { '*': 'u' } });
  }
  for (let i = 0; i < 6; i++) {
    const a = 7.5 + i * 15;
    for (const r of [3.75, 12.25]) {
      const L = 2 * r * Math.tan(Math.PI / 24) + 0.5;
      cv.box([8 - r - 0.75, 1.5, -8 - L / 2], [8 - r + 0.75, 3, -8 + L / 2], 'track_rail', { rot: { axis: 'y', angle: a, pivot: [8, 2.25, -8] } });
    }
  }
  return m;
}
