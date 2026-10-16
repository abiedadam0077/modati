// Reusable part builders shared by block models and rotor (entity) models.
// All parts are authored in world space; rotating parts use spin axis Y through (0,8,0).
import { discY, teethY, ringY, spokesY } from '../lib/model.mjs';

/** Andesite shaft along Y, full block length (or custom extent). */
export function shaftY(bone, y0 = 0, y1 = 16, opts = {}) {
  const r = opts.r ?? 2;
  bone.box([-r, y0, -r], [r, y1, r], opts.mat ?? 'andesite', {
    hide: opts.hideEnds ? ['up', 'down'] : [],
    detail: { up: 'center_dot', down: 'center_dot' },
    grain: { '*': 'v' },
    border: { north: false, south: false, east: false, west: false, up: true, down: true },
    variant: 3,
  });
  // two thin bands to make rotation readable
  if (!opts.noBands && y1 - y0 >= 10) {
    const yb = (y0 + y1) / 2;
    bone.box([-r - 0.25, yb - 3.5, -r - 0.25], [r + 0.25, yb - 2.5, r + 0.25], opts.bandMat ?? 'andesite_dark', { hide: ['up', 'down'], border: false });
    bone.box([-r - 0.25, yb + 2.5, -r - 0.25], [r + 0.25, yb + 3.5, r + 0.25], opts.bandMat ?? 'andesite_dark', { hide: ['up', 'down'], border: false });
  }
}

/** Small cogwheel (spin axis Y), 16px across including teeth, 8 teeth. */
export function smallCogY(bone, opts = {}) {
  const y0 = 6, y1 = 10;
  // wooden body (octagon-ish 12-gon)
  discY(bone, 0, 0, y0, y1, 6.2, 'wood', { steps: 3, cube: { grain: { '*': 'u' } } });
  // teeth (wood with brass caps look -> use wood_dark)
  teethY(bone, 0, 0, y0 + 0.01, y1 - 0.01, 5.2, 8, 8, 2.6, 'wood_dark', { phase: 0 });
  // andesite hub plates on both faces
  discY(bone, 0, 0, y0 - 0.75, y0, 3.4, 'andesite', { steps: 2 });
  discY(bone, 0, 0, y1, y1 + 0.75, 3.4, 'andesite', { steps: 2 });
  if (!opts.noShaft) shaftY(bone, 0, 16, { noBands: true });
}

/** Large cogwheel (spin axis Y). scale: 1 = rotor size (tips ~16.5px), static block uses ~0.9 */
export function largeCogY(bone, opts = {}) {
  const k = opts.scale ?? 1;
  const y0 = 6, y1 = 10;
  const rTip = 16.4 * k, rRoot = 13.6 * k;
  // spokes + rim construction (lighter than a solid disc, reads as "large wheel")
  ringY(bone, 0, 0, y0, y1, rRoot + 0.2, 3.2 * k, 16, 'wood', { cube: { grain: { '*': 'u' } } });
  spokesY(bone, 0, 0, y0 + 0.5, y1 - 0.5, 2.5, rRoot - 2, 6, 2.4, 'wood_dark', { phase: 15 });
  teethY(bone, 0, 0, y0 + 0.01, y1 - 0.01, rRoot - 0.2, rTip, 16, 2.6 * Math.min(1, k + 0.05), 'wood_dark', { phase: 0 });
  // hub
  discY(bone, 0, 0, y0 - 1, y1 + 1, 4.2, 'andesite', { steps: 2 });
  discY(bone, 0, 0, y0 - 1.5, y1 + 1.5, 2.6, 'andesite_dark', { steps: 1 });
  if (!opts.noShaft) shaftY(bone, 0, 16, { noBands: true });
}

/** Casing frame cube helper: a box with frame material outside and panel detail. */
export function casingBox(bone, from, to, frameMat = 'andesite', panelMat = 'wood', opts = {}) {
  bone.box(from, to, frameMat, { detail: { '*': opts.detail ?? 'rivets' }, ...opts.cube });
  if (opts.panels !== false) {
    const inset = 0.05;
    const [x0, y0, z0] = from, [x1, y1, z1] = to;
    const m = opts.margin ?? 2;
    const faces = opts.panelFaces ?? ['north', 'south', 'east', 'west'];
    for (const f of faces) {
      if (f === 'north' && z1 - z0 > 0) bone.box([x0 + m, y0 + m, z0 - inset], [x1 - m, y1 - m, z0], panelMat, { hide: ['south', 'up', 'down', 'east', 'west'], planks: true, grain: { '*': 'u' } });
      if (f === 'south') bone.box([x0 + m, y0 + m, z1], [x1 - m, y1 - m, z1 + inset], panelMat, { hide: ['north', 'up', 'down', 'east', 'west'], planks: true, grain: { '*': 'u' } });
      if (f === 'west') bone.box([x0 - inset, y0 + m, z0 + m], [x0, y1 - m, z1 - m], panelMat, { hide: ['east', 'up', 'down', 'north', 'south'], planks: true, grain: { '*': 'u' } });
      if (f === 'east') bone.box([x1, y0 + m, z0 + m], [x1 + inset, y1 - m, z1 - m], panelMat, { hide: ['west', 'up', 'down', 'north', 'south'], planks: true, grain: { '*': 'u' } });
      if (f === 'up') bone.box([x0 + m, y1, z0 + m], [x1 - m, y1 + inset, z1 - m], panelMat, { hide: ['down', 'north', 'south', 'east', 'west'], planks: true, grain: { '*': 'u' } });
      if (f === 'down') bone.box([x0 + m, y0 - inset, z0 + m], [x1 - m, y0, z1 - m], panelMat, { hide: ['up', 'north', 'south', 'east', 'west'], planks: true, grain: { '*': 'u' } });
    }
  }
}
