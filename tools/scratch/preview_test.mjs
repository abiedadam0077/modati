import { Model } from '../lib/model.mjs';
import { geometryToQuads, renderQuads } from '../lib/render.mjs';
import { shaftY, smallCogY, largeCogY } from '../models/parts.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const out = '/tmp/prev'; fs.mkdirSync(out, { recursive: true });
function prev(model, name, opts = {}) {
  const { atlas } = model.bake();
  const geo = model.toGeometry();
  const quads = geometryToQuads(geo, model.kind, opts.bones || {});
  const files = [];
  for (const view of ['se', 'nw']) {
    const img = renderQuads(quads, { default: atlas }, { view, scale: opts.scale ?? 6, size: opts.size ?? 256, center: opts.center });
    const f = `${out}/${name}_${view}.png`; img.save(f); files.push(f);
  }
  atlas.scaled(4).save(`${out}/${name}_atlas.png`);
  return files;
}
const all = [];
{ const m = new Model('shaft', 'entity'); const b = m.bone('spin', { pivot: [0, 8, 0] }); shaftY(b); all.push(...prev(m, 'shaft')); }
{ const m = new Model('cog', 'entity'); const b = m.bone('spin', { pivot: [0, 8, 0] }); smallCogY(b); all.push(...prev(m, 'cog')); }
{ const m = new Model('lcog', 'entity'); const b = m.bone('spin', { pivot: [0, 8, 0] }); largeCogY(b); all.push(...prev(m, 'lcog', { scale: 4 })); }
execSync(`montage ${all.join(' ')} -tile 6x1 -geometry +2+2 ${out}/sheet1.png`);
console.log('ok');
