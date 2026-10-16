// Procedural 16x16 pixel-art item icons and simple block textures (all original).
import { Image, MATERIALS, hex, mix, shade, hash2, strSeed } from './image.mjs';

const T = (m) => MATERIALS[m].c; // tones [darkest..highlight]
const OUT = hex('#1b1410');

function outline(img, col = OUT) {
  const src = new Image(img.w, img.h);
  src.data.set(img.data);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (src.get(x, y)[3] > 0) continue;
    const n = [src.get(x - 1, y), src.get(x + 1, y), src.get(x, y - 1), src.get(x, y + 1)];
    if (n.some((c) => c[3] > 0)) img.set(x, y, col);
  }
  return img;
}

function poly(img, pts, col) {
  // scanline fill of polygon in pixel coords
  const minY = Math.floor(Math.min(...pts.map((p) => p[1]))), maxY = Math.ceil(Math.max(...pts.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
        xs.push(a[0] + ((y + 0.5 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) img.set(x, y, typeof col === 'function' ? col(x, y) : col);
  }
}

function disc(img, cx, cy, r, col) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r * r) img.set(x, y, typeof col === 'function' ? col(x, y, dx, dy) : col);
  }
}

export function ingot(mat) {
  const c = T(mat);
  const img = new Image(16, 16);
  poly(img, [[2, 9], [9, 4], [14, 7], [7, 12]], (x, y) => {
    const t = (x - y + 8) / 16;
    return t > 0.62 ? c[4] : t > 0.45 ? c[3] : t > 0.3 ? c[2] : c[1];
  });
  poly(img, [[2, 9], [7, 12], [7, 13], [2, 10]], c[1]);
  poly(img, [[7, 12], [14, 7], [14, 8], [7, 13]], c[0]);
  img.set(9, 6, c[4]); img.set(10, 6, c[4]); img.set(8, 7, c[4]);
  return outline(img);
}

export function nugget(mat) {
  const c = T(mat);
  const img = new Image(16, 16);
  disc(img, 7, 9, 3.6, (x, y, dx, dy) => (dx + dy < -2 ? c[4] : dx + dy < 0 ? c[3] : dx + dy < 2 ? c[2] : c[1]));
  disc(img, 10.5, 7, 2.4, (x, y, dx, dy) => (dx + dy < -1 ? c[4] : dx + dy < 1 ? c[3] : c[2]));
  return outline(img);
}

export function sheet(mat) {
  const c = T(mat);
  const img = new Image(16, 16);
  poly(img, [[1, 8], [8, 3], [15, 8], [8, 13]], (x, y) => {
    const n = hash2(x, y, 7);
    const t = (x - y + 6) / 14;
    let col = t > 0.6 ? c[3] : t > 0.25 ? c[2] : c[1];
    if (n > 0.9) col = c[4];
    return col;
  });
  poly(img, [[1, 8], [8, 13], [8, 14], [1, 9]], c[1]);
  poly(img, [[8, 13], [15, 8], [15, 9], [8, 14]], c[0]);
  for (let i = 0; i < 4; i++) img.set(6 + i, 6 + (i % 2), c[4]);
  return outline(img);
}

export function rawOre(mat) {
  const c = T(mat);
  const img = new Image(16, 16);
  poly(img, [[3, 6], [7, 3], [12, 4], [14, 9], [11, 13], [5, 13], [2, 10]], (x, y) => {
    const n = hash2(x, y, 3);
    return n > 0.75 ? c[3] : n > 0.4 ? c[2] : n > 0.15 ? c[1] : c[4];
  });
  return outline(img);
}

export function crushed(mat) {
  const c = T(mat);
  const s = T('stone');
  const img = new Image(16, 16);
  const pts = [[4, 5], [9, 4], [12, 7], [6, 9], [10, 11], [4, 11], [7, 13], [12, 12]];
  for (const [x, y] of pts) {
    disc(img, x, y, 1.9, (px, py, dx, dy) => (hash2(px, py, 9) > 0.5 ? (dx + dy < 0 ? c[3] : c[2]) : (dx + dy < 0 ? s[3] : s[1])));
  }
  return outline(img);
}

export function dust(col1, col2) {
  const a = hex(col1), b = hex(col2);
  const img = new Image(16, 16);
  poly(img, [[2, 13], [5, 8], [8, 6], [11, 8], [14, 13]], (x, y) => (hash2(x, y, 5) > 0.55 ? a : b));
  return outline(img);
}

export function dough() {
  const img = new Image(16, 16);
  const c = [hex('#9c8256'), hex('#c4a874'), hex('#ddc493'), hex('#efdcb4')];
  disc(img, 8, 9, 5.4, (x, y, dx, dy) => (dx + dy < -4 ? c[3] : dx + dy < 0 ? c[2] : dx + dy < 4 ? c[1] : c[0]));
  return outline(img);
}

export function xpNugget() {
  const img = new Image(16, 16);
  const c = [hex('#3a6d10'), hex('#62a51c'), hex('#9ee03a'), hex('#e2ff9a')];
  disc(img, 8, 8, 4.4, (x, y, dx, dy) => (dx + dy < -3 ? c[3] : dx + dy < 0 ? c[2] : dx + dy < 3 ? c[1] : c[0]));
  img.set(6, 6, hex('#ffffff'));
  return outline(img);
}

function gearIcon(img, cx, cy, r, mat, teeth = 8) {
  const c = T(mat);
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * Math.PI * 2;
    disc(img, cx + Math.cos(a) * (r + 0.6), cy + Math.sin(a) * (r + 0.6), 1.2, c[1]);
  }
  disc(img, cx, cy, r, (x, y, dx, dy) => (dx + dy < -1 ? c[3] : dx + dy < 1.5 ? c[2] : c[1]));
  disc(img, cx, cy, r * 0.35, T('andesite_dark')[1]);
}

export function mechanism() {
  const img = new Image(16, 16);
  poly(img, [[1, 10], [8, 6], [15, 10], [8, 14]], T('gold')[2]);
  gearIcon(img, 6, 8, 3.2, 'wood_light');
  gearIcon(img, 11, 9, 2.2, 'brass');
  return outline(img);
}

export function electronTube() {
  const img = new Image(16, 16);
  const g = T('glass');
  poly(img, [[6, 3], [10, 3], [11, 10], [5, 10]], (x, y) => (x < 8 ? g[3] : g[2]));
  disc(img, 8, 6.5, 1.6, hex('#ff8a3a'));
  img.set(8, 6, hex('#ffe08a'));
  poly(img, [[4, 10], [12, 10], [12, 12], [4, 12]], T('iron')[2]);
  img.set(6, 13, T('iron')[1]); img.set(10, 13, T('iron')[1]);
  return outline(img);
}

export function propellerIcon() {
  const img = new Image(16, 16);
  const c = T('iron');
  poly(img, [[7, 7], [3, 2], [5, 1], [9, 7]], c[3]);
  poly(img, [[9, 9], [13, 14], [11, 15], [7, 9]], c[2]);
  poly(img, [[7, 9], [2, 13], [1, 11], [7, 7]], c[2]);
  poly(img, [[9, 7], [14, 3], [15, 5], [9, 9]], c[3]);
  disc(img, 8, 8, 1.8, T('andesite')[2]);
  return outline(img);
}

export function whisk() {
  const img = new Image(16, 16);
  const c = T('iron');
  for (let y = 2; y < 8; y++) img.set(8, y, c[2]);
  for (const [x0] of [[5], [8], [11]]) {
    for (let y = 8; y < 14; y++) img.set(x0 + Math.round(Math.sin((y - 8) / 2) * 0.5), y, c[3]);
  }
  for (let x = 5; x <= 11; x++) img.set(x, 14, c[1]);
  for (let x = 6; x <= 10; x++) img.set(x, 8, c[2]);
  return outline(img);
}

export function brassHand() {
  const img = new Image(16, 16);
  const c = T('brass');
  poly(img, [[5, 7], [11, 7], [11, 13], [5, 13]], (x, y) => (x < 8 ? c[3] : c[2]));
  for (const x of [5, 7, 9, 11]) for (let y = 3; y < 7; y++) img.set(x, y, c[3]);
  poly(img, [[3, 9], [5, 9], [5, 12], [3, 11]], c[2]);
  return outline(img);
}

export function beltConnector() {
  const img = new Image(16, 16);
  const r = T('rubber');
  disc(img, 8, 8, 6, (x, y, dx, dy) => (Math.hypot(dx, dy) > 3.5 ? (dx + dy < 0 ? r[4] : r[3]) : [0, 0, 0, 0]));
  for (let a = 0; a < 8; a++) {
    const x = Math.round(8 + Math.cos(a * 0.785) * 4.8), y = Math.round(8 + Math.sin(a * 0.785) * 4.8);
    img.set(x, y, r[1]);
  }
  return outline(img);
}

export function superGlue() {
  const img = new Image(16, 16);
  poly(img, [[5, 5], [11, 5], [12, 14], [4, 14]], (x, y) => (x < 8 ? hex('#e8e8e8') : hex('#c8c8c8')));
  poly(img, [[6, 8], [10, 8], [10, 11], [6, 11]], hex('#5aa832'));
  poly(img, [[7, 2], [9, 2], [9, 5], [7, 5]], T('brass')[2]);
  img.set(8, 1, hex('#bff27a'));
  return outline(img);
}

export function wrench() {
  const img = new Image(16, 16);
  const g = T('gold'), w = T('wood');
  for (let i = 0; i < 7; i++) { img.set(3 + i, 12 - i, w[2]); img.set(4 + i, 12 - i, w[3]); }
  poly(img, [[9, 6], [12, 2], [15, 4], [13, 6], [14, 8], [11, 9]], (x, y) => ((x + y) % 3 ? g[2] : g[3]));
  img.set(13, 5, [0, 0, 0, 0]);
  return outline(img);
}

export function goggles() {
  const img = new Image(16, 16);
  const b = T('brass'), l = T('wood_dark');
  for (let x = 1; x < 15; x++) img.set(x, 7, l[2]);
  for (const cx of [5, 11]) {
    disc(img, cx, 8, 3.3, b[2]);
    disc(img, cx, 8, 2.2, (x, y, dx, dy) => (dx + dy < 0 ? hex('#ffe9a8') : hex('#e0a83c')));
  }
  return outline(img);
}

export function filterIcon() {
  const img = new Image(16, 16);
  const w = T('wood_light'), c = T('canvas');
  poly(img, [[2, 3], [14, 3], [14, 13], [2, 13]], w[2]);
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) img.set(x, y, (x + y) % 2 ? c[2] : c[3]);
  return outline(img);
}

export function manual() {
  const img = new Image(16, 16);
  poly(img, [[3, 2], [13, 2], [13, 14], [3, 14]], T('brass')[1]);
  poly(img, [[4, 3], [12, 3], [12, 13], [4, 13]], hex('#f1e6c8'));
  gearIcon(img, 8, 8, 2.6, 'copper', 6);
  return outline(img);
}

export function tool(kind) {
  switch (kind) {
    default: return manual();
  }
}

// ------------------------------------------------------------------ block textures
export function casingTexture(frameMat, panelMat) {
  const img = new Image(16, 16);
  const f = T(frameMat), p = T(panelMat);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x < 2 || y < 2 || x > 13 || y > 13;
    const n = hash2(x, y, strSeed(frameMat + panelMat));
    if (edge) {
      let col = n > 0.8 ? f[3] : n > 0.3 ? f[2] : f[1];
      if (x === 0 || y === 0) col = f[4];
      if (x === 15 || y === 15) col = f[0];
      img.set(x, y, col);
    } else {
      const lane = (y - 2) % 4;
      let col = lane === 3 ? p[1] : n > 0.7 ? p[3] : p[2];
      if (x === 2 || y === 2) col = p[0];
      img.set(x, y, col);
    }
  }
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) img.set(x, y, f[4]);
  return img;
}

export function oreTexture(baseMat, oreMat, deep = false) {
  const img = new Image(16, 16);
  const b = T(baseMat), o = T(oreMat);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = hash2(x, y, deep ? 77 : 33);
    img.set(x, y, n > 0.8 ? b[3] : n > 0.4 ? b[2] : n > 0.15 ? b[1] : b[0]);
    if (deep && y % 4 === 0 && n > 0.3) img.set(x, y, b[1]);
  }
  const spots = [[3, 3], [10, 2], [6, 7], [12, 8], [3, 11], [9, 12], [13, 13]];
  for (const [x, y] of spots) {
    img.set(x, y, o[3]); img.set(x + 1, y, o[2]); img.set(x, y + 1, o[1]); img.set(x + 1, y + 1, o[2]);
  }
  return img;
}

export function metalBlockTexture(mat) {
  const img = new Image(16, 16);
  const c = T(mat);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = hash2(x, y, strSeed(mat));
    let col = n > 0.85 ? c[3] : n > 0.2 ? c[2] : c[1];
    if (x === 0 || y === 0) col = c[4];
    if (x === 15 || y === 15) col = c[0];
    if ((x === 7 || x === 8) && y > 2 && y < 13) col = c[1];
    img.set(x, y, col);
  }
  return img;
}

/** Belt surface flipbook: frames scroll along v (top of texture = north). */
export function beltFlipbook(step, dirSign) {
  // 16 px pattern period, `step` px per frame -> frames = 16/step (min 1)
  const frames = Math.max(1, Math.round(16 / Math.max(1, step)));
  const w = 16, h = 16;
  const img = new Image(w, h * frames);
  const r = T('rubber');
  for (let f = 0; f < frames; f++) {
    const off = dirSign * f * step;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const yy = (((y - off) % 16) + 16) % 16;
      let col = r[2];
      if (yy % 4 === 0) col = r[0];
      else if (yy % 4 === 1) col = r[3];
      if (x === 0 || x === 13) col = r[1];
      if (x > 13) col = r[1];
      img.set(x, f * h + y, col);
    }
  }
  return { img, frames };
}
export { shade, mix };
