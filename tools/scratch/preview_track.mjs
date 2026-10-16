import { BLOCK_MODELS } from '../models/blocks.mjs';
import { geometryToQuads, renderQuads } from '../lib/render.mjs';
import { Image } from '../lib/image.mjs';
const m = BLOCK_MODELS.track();
const { atlas } = m.bake('track');
const geo = m.toGeometry();
const out = new Image(640, 160);
let x = 0;
for (const hide of [['curve'], ['straight']]) {
  for (const view of ['se', 'top']) {
    const q = geometryToQuads(geo, 'block', {}, hide);
    const img = renderQuads(q, { default: atlas }, view === 'top' ? { pitch: 89, yaw: 0, size: 160, scale: 6, center: [0, 1, 0] } : { view: 'se', size: 160, scale: 6, center: [0, 1, 0] });
    out.blit(img, x, 0); x += 160;
  }
}
out.save('tools/scratch/track.png');
