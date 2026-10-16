// Software preview renderer for exported Bedrock geometry (used for visual QA of every model).
// It re-imports the *exported JSON* (inverse of the exporter conventions), so it validates
// the full export pipeline, then rasterizes textured faces with a z-buffer.
import { Image } from './image.mjs';

function rotPoint(p, pivot, rotDeg, order = 'ZYX') {
  // three.js-style RH euler (internal frame); Blockbench bedrock uses order ZYX
  let [x, y, z] = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const [rx, ry, rz] = rotDeg.map((d) => (d * Math.PI) / 180);
  const applyX = () => { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; };
  const applyY = () => { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; };
  const applyZ = () => { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; };
  // Matrix order ZYX means v' = Rz * Ry * Rx * v  -> apply X first
  if (order === 'ZYX') { applyX(); applyY(); applyZ(); } else { applyZ(); applyY(); applyX(); }
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

/**
 * Convert exported geometry JSON into world-space textured quads.
 * kind: 'block' | 'entity'. boneTransforms: optional {boneName: {rotation:[bedrock euler], position:[bedrock]}}
 */
export function geometryToQuads(geoJson, kind, boneTransforms = {}, hiddenBones = []) {
  const geo = geoJson['minecraft:geometry'][0];
  const bones = new Map(geo.bones.map((b) => [b.name, b]));
  const quads = [];
  const toWorld = kind === 'entity' ? (p) => [-p[0], p[1], -p[2]] : (p) => p;
  const chain = (b) => {
    const list = [];
    let cur = b;
    while (cur) { list.push(cur); cur = cur.parent ? bones.get(cur.parent) : null; }
    return list; // self first
  };
  const isHidden = (b) => chain(b).some((x) => hiddenBones.includes(x.name));
  for (const b of geo.bones) {
    if (!b.cubes || isHidden(b)) continue;
    const ch = chain(b);
    for (const c of b.cubes) {
      const size = c.size;
      const lo = [-(c.origin[0]) - size[0], c.origin[1], c.origin[2]]; // internal
      const hi = [lo[0] + size[0], lo[1] + size[1], lo[2] + size[2]];
      const infl = c.inflate || 0;
      for (let i = 0; i < 3; i++) { lo[i] -= infl; hi[i] += infl; }
      const cubePivot = c.pivot ? [-c.pivot[0], c.pivot[1], c.pivot[2]] : null;
      const cubeRot = c.rotation ? [-c.rotation[0], -c.rotation[1], c.rotation[2]] : null;
      const xform = (p) => {
        let q = p;
        if (cubeRot) q = rotPoint(q, cubePivot, cubeRot);
        for (const bb of ch) {
          const t = boneTransforms[bb.name] || {};
          const piv = [-bb.pivot[0], bb.pivot[1], bb.pivot[2]];
          const r0 = bb.rotation ? [-bb.rotation[0], -bb.rotation[1], bb.rotation[2]] : [0, 0, 0];
          const ra = t.rotation ? [-t.rotation[0], -t.rotation[1], t.rotation[2]] : [0, 0, 0];
          const rot = [r0[0] + ra[0], r0[1] + ra[1], r0[2] + ra[2]];
          if (rot[0] || rot[1] || rot[2]) q = rotPoint(q, piv, rot);
          if (t.position) q = [q[0] - t.position[0], q[1] + t.position[1], q[2] + t.position[2]];
        }
        return toWorld(q);
      };
      const X0 = lo[0], X1 = hi[0], Y0 = lo[1], Y1 = hi[1], Z0 = lo[2], Z1 = hi[2];
      const corners = {
        east: [[X1, Y1, Z1], [X1, Y1, Z0], [X1, Y0, Z1], [X1, Y0, Z0]],
        west: [[X0, Y1, Z0], [X0, Y1, Z1], [X0, Y0, Z0], [X0, Y0, Z1]],
        up: [[X0, Y1, Z0], [X1, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1]],
        down: [[X0, Y0, Z1], [X1, Y0, Z1], [X0, Y0, Z0], [X1, Y0, Z0]],
        south: [[X0, Y1, Z1], [X1, Y1, Z1], [X0, Y0, Z1], [X1, Y0, Z1]],
        north: [[X1, Y1, Z0], [X0, Y1, Z0], [X1, Y0, Z0], [X0, Y0, Z0]],
      };
      for (const [face, e] of Object.entries(c.uv || {})) {
        let u1, v1, u2, v2;
        if (face === 'up' || face === 'down') {
          u1 = e.uv[0] + e.uv_size[0]; v1 = e.uv[1] + e.uv_size[1]; u2 = e.uv[0]; v2 = e.uv[1];
        } else {
          u1 = e.uv[0]; v1 = e.uv[1]; u2 = e.uv[0] + e.uv_size[0]; v2 = e.uv[1] + e.uv_size[1];
        }
        const pts = corners[face].map(xform);
        quads.push({ pts, uv: [[u1, v1], [u2, v1], [u1, v2], [u2, v2]], instance: e.material_instance || null });
      }
    }
  }
  return quads;
}

/**
 * Render quads into an image. view: 'se' (from south-east, above) or 'nw' or 'front'.
 * textures: { default: Image, [instance]: Image }
 */
export function renderQuads(quads, textures, opts = {}) {
  const scale = opts.scale ?? 6;
  const size = opts.size ?? 256;
  const img = new Image(size, size, opts.bg ?? [40, 44, 52, 255]);
  const zbuf = new Float32Array(size * size).fill(-Infinity);
  const yaw = ((opts.yaw ?? (opts.view === 'nw' ? 225 : 45)) * Math.PI) / 180;
  const pitch = ((opts.pitch ?? 30) * Math.PI) / 180;
  const center = opts.center ?? [0, 8, 0];
  // camera: rotate world around Y by yaw then tilt by pitch; screen x right, y up, z towards viewer
  const proj = (p) => {
    let x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    [x, z] = [x * cy - z * sy, x * sy + z * cy];
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    return [size / 2 + x * scale, size / 2 - y * scale, z];
  };
  const light = (n) => {
    // minecraft-like directional shading
    const l = 0.55 + 0.45 * Math.max(0, n[1]) + 0.25 * Math.abs(n[2]) * 0.8 + 0.15 * Math.abs(n[0]);
    return Math.min(1.1, l);
  };
  for (const q of quads) {
    const tex = (q.instance && textures[q.instance]) || textures.default;
    if (!tex) continue;
    const P = q.pts.map(proj);
    // face normal (world)
    const a = q.pts[0], b = q.pts[1], c = q.pts[2];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    // our corner order (TL,TR,BL) yields inward/outward depending on face; use abs lighting
    const shadeF = light([Math.abs(n[0]), n[1] < 0 ? -n[1] * 0.3 : n[1], Math.abs(n[2])]);
    const tris = [[0, 1, 2], [1, 3, 2]];
    for (const t of tris) rasterTri(img, zbuf, tex, P[t[0]], P[t[1]], P[t[2]], q.uv[t[0]], q.uv[t[1]], q.uv[t[2]], shadeF);
  }
  return img;
}

function rasterTri(img, zbuf, tex, p0, p1, p2, t0, t1, t2, shadeF) {
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(img.w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(img.h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
      let w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
      const idx = y * img.w + x;
      if (z <= zbuf[idx]) continue;
      let u = w0 * t0[0] + w1 * t1[0] + w2 * t2[0];
      let v = w0 * t0[1] + w1 * t1[1] + w2 * t2[1];
      const tu = Math.min(tex.w - 1, Math.max(0, Math.floor(u - 1e-4 * Math.sign(t1[0] - t0[0] || 1))));
      const tv = Math.min(tex.h - 1, Math.max(0, Math.floor(v - 1e-4 * Math.sign(t2[1] - t0[1] || 1))));
      const col = tex.get(tu, tv);
      if (col[3] < 128) continue;
      zbuf[idx] = z;
      img.set(x, y, [Math.min(255, col[0] * shadeF), Math.min(255, col[1] * shadeF), Math.min(255, col[2] * shadeF), 255]);
    }
  }
}
