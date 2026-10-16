// Rotor (entity) models. Shared bone hierarchy driven by animation.craftoria.rotor.*:
//   yaw (cancels body yaw) > orient (local +Y -> axis/facing) > roll > spin | spin_b | spin_r | spin_rb | spin2 | spinx | hand | ...
//   yaw > fixed (world-aligned parts: press head, mixer head, arm, rope)
// Index order MUST match ROTOR in src/scripts/kinetics/defs.ts.
import { Model, discY, teethY } from '../lib/model.mjs';
import { shaftY, smallCogY, largeCogY } from './parts.mjs';
import { crankParts, waterWheelParts, crushingWheelParts, pressHead, mixerWhisk, drillHead, sawBlade, deployerHand, propeller } from './blocks.mjs';

function rotorModel(name, vb = [3, 3, 0.5]) {
  const m = new Model(`rotor_${name}`, 'entity', { visibleBounds: vb });
  m.bone('yaw', { pivot: [0, 0, 0] });
  m.bone('orient', { parent: 'yaw', pivot: [0, 8, 0] });
  m.bone('roll', { parent: 'orient', pivot: [0, 8, 0] });
  return m;
}
const spin = (m, name = 'spin', parent = 'roll') => m.bone(name, { parent, pivot: [0, 8, 0] });

/** half shaft pointing along local +Y from the center, in a stub bone rotated to face `toward` */
function stub(m, stubName, spinName, rot) {
  m.bone(stubName, { parent: 'roll', pivot: [0, 8, 0], rotation: rot });
  const s = m.bone(spinName, { parent: stubName, pivot: [0, 8, 0] });
  shaftY(s, 8, 16.6, { noBands: true });
  s.box([-2.5, 13, -2.5], [2.5, 14, 2.5], 'andesite_dark', { hide: ['up', 'down'] });
}

export const ROTOR_MODELS = [
  /* 0 shaft */ () => { const m = rotorModel('shaft'); shaftY(spin(m)); return m; },
  /* 1 cog */ () => { const m = rotorModel('cog'); smallCogY(spin(m)); return m; },
  /* 2 large_cog */ () => { const m = rotorModel('large_cog', [4, 4, 0.5]); largeCogY(spin(m)); return m; },
  /* 3 gearbox */ () => {
    const m = rotorModel('gearbox');
    stub(m, 'stub_px', 'spin', { axis: 'z', angle: -90 });
    stub(m, 'stub_nx', 'spin_b', { axis: 'z', angle: 90 });
    stub(m, 'stub_pz', 'spin_r', { axis: 'x', angle: 90 });
    stub(m, 'stub_nz', 'spin_rb', { axis: 'x', angle: -90 });
    return m;
  },
  /* 4 split_shaft (unused placeholder index kept for compatibility: a plain shaft) */ () => { const m = rotorModel('split'); shaftY(spin(m)); return m; },
  /* 5 crank */ () => { const m = rotorModel('crank'); crankParts(spin(m)); return m; },
  /* 6 motor */ () => { const m = rotorModel('motor'); const s = spin(m); shaftY(s, 13, 16.5, { noBands: true }); s.box([-2.6, 14, -2.6], [2.6, 15, 2.6], 'andesite_dark', { hide: ['up', 'down'] }); return m; },
  /* 7 water_wheel */ () => { const m = rotorModel('water_wheel', [3, 3, 0.5]); waterWheelParts(spin(m), 1.08); return m; },
  /* 8 press */ () => {
    const m = rotorModel('press', [2, 3.5, -0.25]);
    shaftY(spin(m));
    m.bone('fixed', { parent: 'yaw', pivot: [0, 0, 0] });
    const h = m.bone('press_head', { parent: 'fixed', pivot: [0, 8, 0] });
    pressHead(h, 1.5);
    return m;
  },
  /* 9 mixer */ () => {
    const m = rotorModel('mixer', [2, 3.5, -0.25]);
    const s = spin(m);
    discY(s, 0, 0, 7, 11, 5.8, 'wood', { steps: 3 });
    teethY(s, 0, 0, 7.01, 10.99, 5, 8, 8, 2.6, 'wood_dark');
    m.bone('fixed', { parent: 'yaw', pivot: [0, 0, 0] });
    m.bone('mixer_head', { parent: 'fixed', pivot: [0, 0, 0] });
    const w = m.bone('mixer_spin', { parent: 'mixer_head', pivot: [0, 0, 0] });
    mixerWhisk(w, 6);
    return m;
  },
  /* 10 millstone */ () => {
    const m = rotorModel('millstone');
    const s = spin(m);
    discY(s, 0, 0, 6, 9, 7.5, 'wood', { steps: 3 });
    teethY(s, 0, 0, 6.01, 8.99, 6.5, 8.2, 8, 2.4, 'wood_dark');
    discY(s, 0, 0, 9, 15, 6.8, 'granite', { steps: 3, cube: { detail: { up: 'center_dot' } } });
    s.box([-1, 15, -1], [1, 16, 1], 'iron');
    s.box([-6, 14.9, -0.5], [6, 15.2, 0.5], 'stone');
    return m;
  },
  /* 11 crushing_wheel */ () => { const m = rotorModel('crushing_wheel', [3, 3, 0.5]); crushingWheelParts(spin(m), 1.0); return m; },
  /* 12 drill */ () => { const m = rotorModel('drill'); drillHead(spin(m)); return m; },
  /* 13 saw */ () => {
    const m = rotorModel('saw');
    const s = spin(m, 'spinx');
    sawBlade(s);
    s.box([-8.5, 3, -2], [-6, 7, 2], 'andesite', { detail: { west: 'center_dot' } });
    s.box([6, 3, -2], [8.5, 7, 2], 'andesite', { detail: { east: 'center_dot' } });
    return m;
  },
  /* 14 deployer */ () => {
    const m = rotorModel('deployer', [2, 3, 0.5]);
    const s = spin(m, 'spinx');
    s.box([-8.5, 4, -2], [-6, 8, 2], 'andesite', { detail: { west: 'center_dot' } });
    s.box([6, 4, -2], [8.5, 8, 2], 'andesite', { detail: { east: 'center_dot' } });
    const h = m.bone('hand', { parent: 'roll', pivot: [0, 8, 0] });
    deployerHand(h, 0);
    m.bone('rightArm', { parent: 'hand', pivot: [0, 16, 0] });
    m.bone('rightItem', { parent: 'rightArm', pivot: [0, 18, 0] });
    return m;
  },
  /* 15 arm */ () => {
    const m = rotorModel('arm', [4, 4, 1]);
    const s = spin(m);
    discY(s, 0, 0, 5, 8, 6.4, 'wood', { steps: 3 });
    teethY(s, 0, 0, 5.01, 7.99, 5.6, 8, 8, 2.4, 'wood_dark');
    m.bone('fixed', { parent: 'yaw', pivot: [0, 0, 0] });
    const base = m.bone('arm_base', { parent: 'fixed', pivot: [0, 8, 0] });
    base.box([-3.5, 8, -3.5], [3.5, 11, 3.5], 'brass', { detail: { '*': 'bolts' } });
    base.box([-2.5, 11, -2.5], [2.5, 13, 2.5], 'andesite_dark');
    const low = m.bone('arm_lower', { parent: 'arm_base', pivot: [0, 12, 0] });
    low.box([-1.5, 12, -1.5], [1.5, 26, 1.5], 'brass', { grain: { '*': 'v' } });
    low.box([-2, 11, -2], [2, 13, 2], 'iron');
    const up = m.bone('arm_upper', { parent: 'arm_lower', pivot: [0, 26, 0] });
    up.box([-1.25, 24.75, -1.25], [1.25, 27.25, 13], 'brass', { grain: { '*': 'u' } });
    up.box([-2, 24.5, -2], [2, 27.5, 2], 'iron');
    const head = m.bone('arm_head', { parent: 'arm_upper', pivot: [0, 26, 13] });
    head.box([-2.5, 22, 11], [2.5, 26, 15], 'andesite_dark', { detail: { down: 'dark_center' } });
    head.box([-2.5, 19, 11.5], [-1.5, 22, 14.5], 'iron');
    head.box([1.5, 19, 11.5], [2.5, 22, 14.5], 'iron');
    m.bone('rightArm', { parent: 'arm_head', pivot: [0, 20, 13] });
    m.bone('rightItem', { parent: 'rightArm', pivot: [0, 18, 13] });
    return m;
  },
  /* 16 fan */ () => { const m = rotorModel('fan'); propeller(spin(m)); return m; },
  /* 17 pump */ () => {
    const m = rotorModel('pump');
    const s = spin(m);
    discY(s, 0, 0, 6, 10, 6, 'wood', { steps: 3 });
    teethY(s, 0, 0, 6.01, 9.99, 5.2, 8, 8, 2.6, 'wood_dark');
    return m;
  },
  /* 18 bearing */ () => {
    const m = rotorModel('bearing');
    const s = spin(m);
    s.box([-7, 12, -7], [7, 16, 7], 'wood', { planks: true, detail: { up: 'rivets' } });
    s.box([-3, 15.9, -3], [3, 16.1, 3], 'iron', { hide: ['down'] });
    return m;
  },
  /* 19 rope_pulley */ () => {
    const m = rotorModel('rope_pulley', [2, 6, -2]);
    const s = spin(m);
    shaftY(s, 0, 16, { noBands: true });
    discY(s, 0, 0, 3, 13, 4.5, 'rope', { steps: 3 });
    m.bone('fixed', { parent: 'yaw', pivot: [0, 0, 0] });
    const r = m.bone('rope', { parent: 'fixed', pivot: [0, 0, 0] });
    r.box([-0.75, -16, -0.75], [0.75, 0, 0.75], 'rope', { hide: ['up', 'down'] });
    const mag = m.bone('rope_magnet', { parent: 'fixed', pivot: [0, 0, 0] });
    mag.box([-3, -2, -3], [3, 0, 3], 'steel', { detail: { down: 'bolts' } });
    return m;
  },
  /* 20 gauge */ () => {
    const m = rotorModel('gauge');
    const s = spin(m);
    shaftY(s, 0, 2.6, { noBands: true });
    shaftY(s, 13.4, 16, { noBands: true });
    // needles on the 4 dial faces: dial bone turns local +Y to the face normal, needle base rotates so the
    // needle (authored along local +Z) points up at rest, needle bone is animated by the gauge value.
    const faces = [
      ['n', { axis: 'x', angle: -90 }, null],
      ['s', { axis: 'x', angle: 90 }, { axis: 'y', angle: 180 }],
      ['e', { axis: 'z', angle: -90 }, { axis: 'y', angle: -90 }],
      ['w', { axis: 'z', angle: 90 }, { axis: 'y', angle: 90 }],
    ];
    for (const [f, rot, rest] of faces) {
      m.bone(`dial_${f}`, { parent: 'roll', pivot: [0, 8, 0], rotation: rot });
      m.bone(`nbase_${f}`, { parent: `dial_${f}`, pivot: [0, 8, 0], rotation: rest });
      const nb = m.bone(`needle_${f}`, { parent: `nbase_${f}`, pivot: [0, 8, 0] });
      nb.box([-0.5, 14.25, -0.5], [0.5, 14.6, 4.5], 'redstone', { border: false });
      nb.box([-1, 14.2, -1], [1, 14.7, 1], 'steel', { border: false });
    }
    return m;
  },
  /* 21 windmill_bearing */ () => {
    const m = rotorModel('windmill_bearing');
    const s = spin(m);
    s.box([-7, 12, -7], [7, 16, 7], 'wood_dark', { planks: true, detail: { up: 'rivets' } });
    s.box([-3, 15.9, -3], [3, 16.1, 3], 'brass', { hide: ['down'] });
    return m;
  },
  /* 22 belt_pulley */ () => {
    const m = rotorModel('belt_pulley');
    const s = spin(m);
    shaftY(s, -0.6, 16.6, { noBands: true });
    s.box([-4.5, 1, -4.5], [4.5, 15, 4.5], 'rubber', { hide: ['up', 'down'] });
    return m;
  },
  /* 23 piston */ () => {
    const m = rotorModel('piston');
    const s = spin(m, 'spinx');
    s.box([-8.5, 4, -2], [-6, 8, 2], 'andesite', { detail: { west: 'center_dot' } });
    s.box([6, 4, -2], [8.5, 8, 2], 'andesite', { detail: { east: 'center_dot' } });
    return m;
  },
  /* 24 clutch */ () => splitRotor('clutch'),
  /* 25 gearshift */ () => splitRotor('gearshift'),
];

function splitRotor(name) {
  const m = rotorModel(name);
  shaftY(spin(m, 'spin'), -0.6, 3.4, { noBands: true });
  shaftY(spin(m, 'spin2'), 12.6, 16.6, { noBands: true });
  return m;
}
