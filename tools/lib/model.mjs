// CRAFTORIA model DSL.
//
// Models are authored in WORLD space, in pixels (16 px = 1 block), origin at the bottom-center
// of the block: x = west(-) -> east(+), y = up, z = north(-) -> south(+).
//
// Export conventions (verified against Blockbench's Bedrock codec, js/formats/bedrock/bedrock.js):
//   Bedrock JSON = Blockbench-internal with X negated (origin/pivot) and rotation X,Y negated;
//   up/down per-face UVs are written flipped (uv += size; size = -size).
//   Blocks:   Blockbench-internal frame == world frame.
//   Entities: Blockbench-internal frame == world frame rotated 180deg about Y (entity front is -Z in
//             model space and an entity with yaw 0 faces south). Rotor entities additionally cancel
//             their body yaw in animation (see vanilla player sleep animation).
import { Image, paintFace, strSeed } from './image.mjs';

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

// World-space normal of each face
const NORMAL = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

/**
 * Face basis in WORLD space for a given model kind: direction of +u and +v on the face texture.
 * Derived from three.js BoxGeometry/Blockbench face UV layout (viewed from outside: u right, v down;
 * up face: u east, v south; down face: u east, v north) in Blockbench-internal frame.
 */
export function faceBasis(kind, face) {
  // internal-frame bases
  const B = {
    north: { u: [-1, 0, 0], v: [0, -1, 0] },
    south: { u: [1, 0, 0], v: [0, -1, 0] },
    east: { u: [0, 0, -1], v: [0, -1, 0] },
    west: { u: [0, 0, 1], v: [0, -1, 0] },
    up: { u: [1, 0, 0], v: [0, 0, 1] },
    down: { u: [1, 0, 0], v: [0, 0, -1] },
  };
  if (kind === 'block') return { key: face, ...B[face] };
  // entity: world -> internal is a 180deg rotation about Y: (x,y,z) -> (-x,y,-z)
  const toInternalFace = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'up', down: 'down' };
  const k = toInternalFace[face];
  const r = (v) => [-v[0], v[1], -v[2]];
  return { key: k, u: r(B[k].u), v: r(B[k].v) };
}

function faceDims(size, face) {
  // [width along u, height along v] in pixels for a cube of world size [sx, sy, sz]
  const [sx, sy, sz] = size;
  switch (face) {
    case 'north': case 'south': return [sx, sy];
    case 'east': case 'west': return [sz, sy];
    default: return [sx, sz];
  }
}

export class Cube {
  constructor(from, to, mat, opts = {}) {
    this.from = from.map(Number);
    this.to = to.map(Number);
    for (let i = 0; i < 3; i++) if (this.to[i] < this.from[i]) [this.from[i], this.to[i]] = [this.to[i], this.from[i]];
    this.mat = mat;
    this.opts = opts; // { hide:[], faceMat:{}, detail: {face|*:..}, rot:{axis,angle,pivot}, inflate, external:{face:{instance,uv,size}}, grain:{face:'u'|'v'} }
  }
  get size() { return [0, 1, 2].map((i) => this.to[i] - this.from[i]); }
  faceVisible(f) {
    const h = this.opts.hide || [];
    if (h.includes(f)) return false;
    const [w, hgt] = faceDims(this.size, f);
    return w > 0 && hgt > 0;
  }
}

export class Bone {
  constructor(name, opts = {}) {
    this.name = name;
    this.parent = opts.parent || null;
    this.pivot = opts.pivot || [0, 0, 0];
    this.rotation = opts.rotation || null; // world-space {axis, angle} (single axis)
    this.cubes = [];
    this.locators = opts.locators || null;
    this.binding = opts.binding || null;
  }
  box(from, to, mat, opts) {
    const c = new Cube(from, to, mat, opts);
    this.cubes.push(c);
    return c;
  }
}

export class Model {
  /** kind: 'block' | 'entity' */
  constructor(name, kind, opts = {}) {
    this.name = name;
    this.kind = kind;
    this.bones = [];
    this.opts = opts; // { visibleBounds:[w,h,offsetY], identifier }
    this.identifier = opts.identifier || `geometry.craftoria.${name}`;
  }
  bone(name, opts) {
    if (this.bones.find((b) => b.name === name)) throw new Error(`duplicate bone ${name} in ${this.name}`);
    const b = new Bone(name, opts);
    this.bones.push(b);
    return b;
  }
  getBone(name) { return this.bones.find((b) => b.name === name); }

  /** Bake textures: returns {atlas: Image, faces: Map(cube->face->rect)} */
  bake(seedBase = this.name) {
    const reqs = [];
    const keyMap = new Map();
    for (const bone of this.bones) {
      for (const cube of bone.cubes) {
        for (const f of FACES) {
          if (!cube.faceVisible(f)) continue;
          if (cube.opts.external && cube.opts.external[f]) continue;
          const mat = (cube.opts.faceMat && (cube.opts.faceMat[f] || cube.opts.faceMat['*'])) || cube.mat;
          if (mat === 'none') continue;
          let [w, h] = faceDims(cube.size, f);
          w = Math.max(1, Math.round(w));
          h = Math.max(1, Math.round(h));
          const detail = cube.opts.detail ? (cube.opts.detail[f] ?? cube.opts.detail['*'] ?? null) : null;
          const grain = cube.opts.grain ? cube.opts.grain[f] ?? cube.opts.grain['*'] : undefined;
          const planks = !!(cube.opts.planks && (cube.opts.planks === true || cube.opts.planks[f]));
          const variant = cube.opts.variant ?? 0;
          const border = cube.opts.border === undefined ? undefined : (typeof cube.opts.border === 'object' ? cube.opts.border[f] ?? cube.opts.border['*'] : cube.opts.border);
          const key = JSON.stringify([mat, w, h, detail, grain, planks, variant, border]);
          let req = keyMap.get(key);
          if (!req) {
            req = { key, mat, w, h, detail, grain, planks, variant, border, users: [] };
            keyMap.set(key, req);
            reqs.push(req);
          }
          req.users.push({ cube, face: f });
        }
      }
    }
    // shelf packing with 1px gutter
    const pad = 1;
    const sorted = [...reqs].sort((a, b) => b.h - a.h || b.w - a.w);
    let W = 16;
    const area = sorted.reduce((s, r) => s + (r.w + 2 * pad) * (r.h + 2 * pad), 0);
    while (W * W < area) W *= 2;
    const maxW = Math.max(W, ...sorted.map((r) => nextPow2(r.w + 2 * pad)));
    W = maxW;
    let placed;
    for (;;) {
      placed = shelfPack(sorted, W, pad);
      if (placed.height <= W * 2) break;
      W *= 2;
    }
    let H = nextPow2(Math.max(16, placed.height));
    const atlas = new Image(W, H);
    const seed0 = strSeed(seedBase);
    for (const r of sorted) {
      paintFace(atlas, {
        x: r.x, y: r.y, w: r.w, h: r.h, mat: r.mat, seed: seed0 + r.variant * 31,
        detail: r.detail, grainAlongU: r.grain === undefined ? undefined : r.grain === 'u', planks: r.planks,
        border: r.border,
      });
      // gutter: extend edges
      for (let i = -pad; i < r.w + pad; i++) {
        const cx = r.x + Math.min(r.w - 1, Math.max(0, i));
        for (let k = 1; k <= pad; k++) {
          atlas.set(r.x + i, r.y - k, atlas.get(cx, r.y));
          atlas.set(r.x + i, r.y + r.h - 1 + k, atlas.get(cx, r.y + r.h - 1));
        }
      }
      for (let j = -pad; j < r.h + pad; j++) {
        const cy = r.y + Math.min(r.h - 1, Math.max(0, j));
        for (let k = 1; k <= pad; k++) {
          atlas.set(r.x - k, r.y + j, atlas.get(r.x, cy));
          atlas.set(r.x + r.w - 1 + k, r.y + j, atlas.get(r.x + r.w - 1, cy));
        }
      }
    }
    const faceRects = new Map();
    for (const r of sorted) {
      for (const u of r.users) {
        if (!faceRects.has(u.cube)) faceRects.set(u.cube, {});
        faceRects.get(u.cube)[u.face] = { x: r.x, y: r.y, w: r.w, h: r.h };
      }
    }
    this._baked = { atlas, faceRects, W, H };
    return this._baked;
  }

  /** Bedrock geometry JSON (format 1.12.0) */
  toGeometry() {
    if (!this._baked) this.bake();
    const { faceRects, W, H } = this._baked;
    const kind = this.kind;
    const toInternal = kind === 'entity' ? (p) => [-p[0], p[1], -p[2]] : (p) => [p[0], p[1], p[2]];
    // internal -> bedrock: negate x
    const pivotOut = (p) => { const q = toInternal(p); return [r4(-q[0]), r4(q[1]), r4(q[2])]; };
    const rotOut = (rot) => {
      // world-space single-axis RH rotation -> bedrock euler
      if (!rot || !rot.angle) return null;
      const a = rot.angle;
      const out = [0, 0, 0];
      if (kind === 'block') {
        if (rot.axis === 'x') out[0] = -a; else if (rot.axis === 'y') out[1] = -a; else out[2] = a;
      } else {
        if (rot.axis === 'x') out[0] = a; else if (rot.axis === 'y') out[1] = -a; else out[2] = -a;
      }
      return out.map(r4);
    };
    const bones = this.bones.map((b) => {
      const jb = { name: b.name };
      if (b.parent) jb.parent = b.parent;
      jb.pivot = pivotOut(b.pivot);
      const br = rotOut(b.rotation);
      if (br) jb.rotation = br;
      if (b.binding) jb.binding = b.binding;
      if (b.locators) {
        jb.locators = {};
        for (const [k, v] of Object.entries(b.locators)) jb.locators[k] = pivotOut(v);
      }
      if (b.cubes.length) {
        jb.cubes = b.cubes.map((c) => {
          // world box -> internal box
          const a = toInternal(c.from), bb = toInternal(c.to);
          const lo = [Math.min(a[0], bb[0]), Math.min(a[1], bb[1]), Math.min(a[2], bb[2])];
          const size = c.size;
          // internal -> bedrock origin: x = -(x0 + sx)
          const jc = { origin: [r4(-(lo[0] + size[0])), r4(lo[1]), r4(lo[2])], size: size.map(r4) };
          if (c.opts.inflate) jc.inflate = c.opts.inflate;
          if (c.opts.rot && c.opts.rot.angle) {
            jc.pivot = pivotOut(c.opts.rot.pivot || [(c.from[0] + c.to[0]) / 2, (c.from[1] + c.to[1]) / 2, (c.from[2] + c.to[2]) / 2]);
            jc.rotation = rotOut(c.opts.rot);
          }
          const uv = {};
          for (const f of FACES) {
            if (!c.faceVisible(f)) continue;
            const basis = faceBasis(kind, f);
            const ext = c.opts.external && c.opts.external[f];
            let u, v, w, h, inst;
            if (ext) {
              [u, v] = ext.uv; [w, h] = ext.size; inst = ext.instance;
            } else {
              const rect = faceRects.get(c) && faceRects.get(c)[f];
              if (!rect) continue;
              ({ x: u, y: v, w, h } = rect);
              inst = c.opts.instance;
            }
            const entry = (basis.key === 'up' || basis.key === 'down')
              ? { uv: [u + w, v + h], uv_size: [-w, -h] }
              : { uv: [u, v], uv_size: [w, h] };
            if (inst) entry.material_instance = inst;
            uv[basis.key] = entry;
          }
          jc.uv = uv;
          return jc;
        });
      }
      return jb;
    });
    const vb = this.opts.visibleBounds || (kind === 'entity' ? [3, 3, 0.75] : [2, 2, 0.5]);
    return {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: {
            identifier: this.identifier,
            texture_width: W,
            texture_height: H,
            visible_bounds_width: vb[0],
            visible_bounds_height: vb[1],
            visible_bounds_offset: [0, vb[2], 0],
          },
          bones,
        },
      ],
    };
  }
}

function r4(x) { return Math.round(x * 10000) / 10000; }
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function shelfPack(rects, W, pad) {
  let x = 0, y = 0, rowH = 0;
  for (const r of rects) {
    const rw = r.w + 2 * pad, rh = r.h + 2 * pad;
    if (rw > W) throw new Error('rect wider than atlas');
    if (x + rw > W) { x = 0; y += rowH; rowH = 0; }
    r.x = x + pad; r.y = y + pad;
    x += rw;
    rowH = Math.max(rowH, rh);
  }
  return { height: y + rowH };
}

// ---------------------------------------------------------------------------
// Geometry helpers (all in world space, spin axis = Y unless noted)

/** Regular polygon prism approximated with N/2... rotated squares about Y. */
export function discY(bone, cx, cz, y0, y1, radius, mat, opts = {}) {
  const steps = opts.steps ?? 2; // 2 => octagon, 3 => 12-gon, 4 => 16-gon
  const half = radius * Math.cos(Math.PI / (steps * 4)); // apothem so corners ~radius
  const s = Math.round(half * 2 * 2) / 2;
  for (let k = 0; k < steps; k++) {
    const angle = (90 / steps) * k;
    bone.box([cx - s / 2, y0, cz - s / 2], [cx + s / 2, y1, cz + s / 2], mat, {
      ...opts.cube,
      rot: angle ? { axis: 'y', angle, pivot: [cx, (y0 + y1) / 2, cz] } : undefined,
      variant: opts.variant ?? k,
    });
  }
}

/** Teeth around the Y axis. */
export function teethY(bone, cx, cz, y0, y1, rInner, rOuter, count, toothW, mat, opts = {}) {
  const phase = opts.phase ?? 0;
  for (let k = 0; k < count; k++) {
    const angle = phase + (360 / count) * k;
    // tooth pointing towards +x before rotation
    bone.box([cx + rInner, y0, cz - toothW / 2], [cx + rOuter, y1, cz + toothW / 2], mat, {
      ...opts.cube,
      rot: angle ? { axis: 'y', angle, pivot: [cx, (y0 + y1) / 2, cz] } : undefined,
    });
  }
}

/** Spokes (thin bars) around Y */
export function spokesY(bone, cx, cz, y0, y1, r0, r1, count, w, mat, opts = {}) {
  const phase = opts.phase ?? 0;
  for (let k = 0; k < count; k++) {
    const angle = phase + (360 / count) * k;
    bone.box([cx + r0, y0, cz - w / 2], [cx + r1, y1, cz + w / 2], mat, {
      ...opts.cube,
      rot: angle ? { axis: 'y', angle, pivot: [cx, (y0 + y1) / 2, cz] } : undefined,
    });
  }
}

/** Ring made of segments (rim) around Y */
export function ringY(bone, cx, cz, y0, y1, radius, thick, segs, mat, opts = {}) {
  const segLen = 2 * radius * Math.tan(Math.PI / segs) + 0.6;
  for (let k = 0; k < segs; k++) {
    const angle = (360 / segs) * k + (opts.phase ?? 0);
    bone.box([cx + radius - thick, y0, cz - segLen / 2], [cx + radius, y1, cz + segLen / 2], mat, {
      ...opts.cube,
      rot: angle ? { axis: 'y', angle, pivot: [cx, (y0 + y1) / 2, cz] } : undefined,
    });
  }
}
