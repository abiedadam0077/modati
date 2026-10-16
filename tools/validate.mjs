// Static validation of the generated packs: JSON syntax, cross references (geometry, textures,
// animations, render controllers, sounds, lang keys, recipe items) and — when Mojang's official
// JSON schemas for 1.26.0 are available locally — schema validation of blocks and items.
//
// Mojang schemas are NOT redistributed (EULA); point CRAFTORIA_SCHEMAS at a checkout of
// https://github.com/Mojang/bedrock-samples (tag v1.26.0.2) metadata/json_schemas to enable.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`JSON parse error in ${file}: ${e.message}`);
    return null;
  }
}

export function validate(BP, RP) {
  const errors = [];
  const warnings = [];
  const rel = (p) => path.relative(path.dirname(BP), p);

  // 1. JSON syntax everywhere
  const jsonFiles = [...walk(BP), ...walk(RP)].filter((f) => f.endsWith('.json'));
  const J = new Map();
  for (const f of jsonFiles) {
    const j = readJson(f, errors);
    if (j) J.set(f, j);
  }

  // 2. collect RP resources
  const geos = new Map(); // id -> bones set
  for (const f of walk(path.join(RP, 'models'))) {
    const j = J.get(f);
    if (!j) continue;
    for (const g of j['minecraft:geometry'] ?? []) {
      const id = g.description.identifier;
      if (geos.has(id)) errors.push(`duplicate geometry ${id}`);
      const bones = new Set((g.bones ?? []).map((b) => b.name));
      geos.set(id, bones);
      // structural checks
      for (const b of g.bones ?? []) {
        if (b.parent && !bones.has(b.parent)) errors.push(`${id}: bone ${b.name} parent ${b.parent} missing`);
        for (const c of b.cubes ?? []) {
          for (const [face, e] of Object.entries(c.uv ?? {})) {
            const u0 = Math.min(e.uv[0], e.uv[0] + e.uv_size[0]), u1 = Math.max(e.uv[0], e.uv[0] + e.uv_size[0]);
            const v0 = Math.min(e.uv[1], e.uv[1] + e.uv_size[1]), v1 = Math.max(e.uv[1], e.uv[1] + e.uv_size[1]);
            if (!e.material_instance && (u0 < 0 || v0 < 0 || u1 > g.description.texture_width || v1 > g.description.texture_height)) {
              errors.push(`${id}: uv out of texture bounds on ${b.name}.${face}`);
            }
          }
        }
      }
    }
  }
  const texFile = (p) => fs.existsSync(path.join(RP, `${p}.png`)) || fs.existsSync(path.join(RP, `${p}.tga`));
  const vanillaTex = new Set(fs.readFileSync(path.join(ROOT, 'tools/data/vanilla_block_textures.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
  const texExists = (p) => texFile(p) || vanillaTex.has(p);

  const terrain = J.get(path.join(RP, 'textures/terrain_texture.json'))?.texture_data ?? {};
  for (const [k, v] of Object.entries(terrain)) {
    const t = typeof v.textures === 'string' ? v.textures : v.textures?.path;
    if (!texExists(t)) errors.push(`terrain texture ${k} -> missing file ${t}`);
  }
  const itemTex = J.get(path.join(RP, 'textures/item_texture.json'))?.texture_data ?? {};
  for (const [k, v] of Object.entries(itemTex)) if (!texExists(v.textures)) errors.push(`item texture ${k} -> missing file ${v.textures}`);
  for (const fb of J.get(path.join(RP, 'textures/flipbook_textures.json')) ?? []) {
    if (!terrain[fb.atlas_tile]) errors.push(`flipbook atlas_tile ${fb.atlas_tile} not in terrain_texture.json`);
    if (!texExists(fb.flipbook_texture)) errors.push(`flipbook texture missing ${fb.flipbook_texture}`);
  }

  // lang
  const langText = fs.existsSync(path.join(RP, 'texts/en_US.lang')) ? fs.readFileSync(path.join(RP, 'texts/en_US.lang'), 'utf8') : '';
  const langKeys = new Set(langText.split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')[0]));

  // 3. blocks
  const customIds = new Set();
  for (const f of walk(path.join(BP, 'blocks'))) {
    const j = J.get(f);
    if (!j) continue;
    const blk = j['minecraft:block'];
    const id = blk.description.identifier;
    customIds.add(id);
    const states = blk.description.states ?? {};
    const comps = blk.components ?? {};
    const check = (c, where) => {
      const g = c['minecraft:geometry'];
      if (g) {
        const gid = typeof g === 'string' ? g : g.identifier;
        if (!gid.startsWith('minecraft:') && !geos.has(gid)) errors.push(`${id}${where}: geometry ${gid} not found`);
        if (typeof g === 'object' && g.bone_visibility) {
          for (const bn of Object.keys(g.bone_visibility)) if (geos.has(gid) && !geos.get(gid).has(bn)) errors.push(`${id}: bone_visibility bone ${bn} not in ${gid}`);
          for (const expr of Object.values(g.bone_visibility)) {
            for (const m of String(expr).matchAll(/block_state\('([^']+)'\)/g)) if (!(m[1] in states)) errors.push(`${id}: bone_visibility uses unknown state ${m[1]}`);
          }
        }
      }
      const mi = c['minecraft:material_instances'];
      if (mi) for (const [k, v] of Object.entries(mi)) {
        const t = typeof v === 'string' ? null : v.texture;
        if (t && !terrain[t]) errors.push(`${id}${where}: material instance ${k} texture ${t} not in terrain_texture.json`);
      }
      if ((c['minecraft:geometry'] && !c['minecraft:material_instances']) || (!c['minecraft:geometry'] && c['minecraft:material_instances'] && where === '')) {
        errors.push(`${id}${where}: geometry and material_instances must be defined together`);
      }
      const loot = c['minecraft:loot'];
      if (loot && !fs.existsSync(path.join(BP, loot))) errors.push(`${id}: loot table ${loot} missing`);
      for (const box of ['minecraft:collision_box', 'minecraft:selection_box']) {
        const v = c[box];
        const list = Array.isArray(v) ? v : typeof v === 'object' ? [v] : [];
        for (const bb of list) {
          const o = bb.origin, s = bb.size;
          if (o[0] < -8 || o[2] < -8 || o[1] < 0 || o[0] + s[0] > 8 || o[2] + s[2] > 8 || o[1] + s[1] > 24) errors.push(`${id}: ${box} out of limits`);
        }
        if (Array.isArray(v) && box === 'minecraft:selection_box') errors.push(`${id}: selection_box cannot be an array`);
        if (Array.isArray(v) && v.length > 16) errors.push(`${id}: too many collision boxes`);
      }
    };
    check(comps, '');
    for (const [i, p] of (blk.permutations ?? []).entries()) {
      check(p.components, ` permutation ${i}`);
      for (const m of String(p.condition).matchAll(/block_state\('([^']+)'\)/g)) if (!(m[1] in states) && !m[1].startsWith('minecraft:')) errors.push(`${id}: permutation uses unknown state ${m[1]}`);
    }
    // permutation count
    let perms = 1;
    for (const v of Object.values(states)) perms *= Array.isArray(v) ? v.length : (v.values.max - v.values.min + 1);
    if (perms > 65536) errors.push(`${id}: too many permutations (${perms})`);
    const name = `tile.${id}.name`;
    if (!langKeys.has(name)) errors.push(`missing lang key ${name}`);
  }

  // 4. items
  for (const f of walk(path.join(BP, 'items'))) {
    const j = J.get(f);
    if (!j) continue;
    const it = j['minecraft:item'];
    const id = it.description.identifier;
    customIds.add(id);
    const icon = it.components['minecraft:icon'];
    const key = typeof icon === 'string' ? icon : icon?.textures?.default;
    if (!itemTex[key]) errors.push(`${id}: icon ${key} not in item_texture.json`);
    const dn = it.components['minecraft:display_name']?.value;
    if (dn && !langKeys.has(dn)) errors.push(`${id}: display name key ${dn} missing from lang`);
  }

  // 5. entities
  const anims = new Set();
  for (const f of walk(path.join(RP, 'animations'))) for (const k of Object.keys(J.get(f)?.animations ?? {})) anims.add(k);
  const rcs = new Map();
  for (const f of walk(path.join(RP, 'render_controllers'))) for (const [k, v] of Object.entries(J.get(f)?.render_controllers ?? {})) rcs.set(k, v);
  const bpEntities = new Set();
  for (const f of walk(path.join(BP, 'entities'))) {
    const j = J.get(f);
    if (j) bpEntities.add(j['minecraft:entity'].description.identifier);
  }
  for (const f of walk(path.join(RP, 'entity'))) {
    const j = J.get(f);
    if (!j) continue;
    const d = j['minecraft:client_entity'].description;
    if (!bpEntities.has(d.identifier)) errors.push(`client entity ${d.identifier} has no behavior definition`);
    for (const [k, g] of Object.entries(d.geometry ?? {})) if (!geos.has(g)) errors.push(`${d.identifier}: geometry ${k} -> ${g} missing`);
    for (const [k, t] of Object.entries(d.textures ?? {})) if (!texExists(t)) errors.push(`${d.identifier}: texture ${k} -> ${t} missing`);
    for (const [k, a] of Object.entries(d.animations ?? {})) if (!anims.has(a)) errors.push(`${d.identifier}: animation ${k} -> ${a} missing`);
    for (const rc of d.render_controllers ?? []) {
      const name = typeof rc === 'string' ? rc : Object.keys(rc)[0];
      const def = rcs.get(name);
      if (!def) {
        errors.push(`${d.identifier}: render controller ${name} missing`);
        continue;
      }
      const refs = JSON.stringify(def).match(/(Geometry|Texture|Material)\.[a-z0-9_]+/g) ?? [];
      for (const r of refs) {
        const [kind, key] = r.split('.');
        const map = kind === 'Geometry' ? d.geometry : kind === 'Texture' ? d.textures : d.materials;
        if (!map || !(key in map)) errors.push(`${d.identifier}: ${name} references ${r} not declared`);
      }
    }
    for (const [k] of Object.entries(d.animations ?? {})) {
      const used = JSON.stringify(d.scripts?.animate ?? []).includes(`"${k}"`);
      if (!used) warnings.push(`${d.identifier}: animation ${k} declared but never animated`);
    }
    // bones referenced by animations should exist in at least one geometry of the entity
    const entityBones = new Set();
    for (const g of Object.values(d.geometry ?? {})) for (const b of geos.get(g) ?? []) entityBones.add(b);
    for (const a of Object.values(d.animations ?? {})) {
      const file = walk(path.join(RP, 'animations')).find((ff) => J.get(ff)?.animations?.[a]);
      const anim = file && J.get(file).animations[a];
      for (const bn of Object.keys(anim?.bones ?? {})) if (!entityBones.has(bn)) warnings.push(`${d.identifier}: animation ${a} bone ${bn} not in any geometry`);
    }
    if (!langKeys.has(`entity.${d.identifier}.name`)) errors.push(`missing lang key entity.${d.identifier}.name`);
  }

  // 6. recipes reference existing items
  let vanillaItems = null;
  try {
    const vd = require(path.join(ROOT, 'node_modules/@minecraft/vanilla-data/lib/index.js'));
    vanillaItems = new Set(Object.values(vd.MinecraftItemTypes ?? {}));
  } catch {
    warnings.push('vanilla-data not available: vanilla recipe items not checked');
  }
  const VANILLA_TAGS = new Set(['minecraft:planks', 'minecraft:logs', 'minecraft:wool']);
  const checkItem = (it, where) => {
    if (!it) return;
    const id = typeof it === 'string' ? it : it.item ?? null;
    if (typeof it === 'object' && it.tag) {
      if (!VANILLA_TAGS.has(it.tag)) warnings.push(`${where}: unverified tag ${it.tag}`);
      return;
    }
    if (!id) return;
    if (id.startsWith('craftoria:')) {
      if (!customIds.has(id)) errors.push(`${where}: unknown item ${id}`);
    } else if (vanillaItems && !vanillaItems.has(id)) errors.push(`${where}: unknown vanilla item ${id}`);
  };
  for (const f of walk(path.join(BP, 'recipes'))) {
    const j = J.get(f);
    if (!j) continue;
    for (const [type, r] of Object.entries(j)) {
      if (type === 'format_version') continue;
      const where = `${rel(f)}`;
      for (const v of Object.values(r.key ?? {})) checkItem(v, where);
      for (const v of r.ingredients ?? []) checkItem(v, where);
      checkItem(r.result, where);
      checkItem(r.input, where);
      checkItem(r.output, where);
      for (const u of r.unlock ?? []) checkItem(u, where);
      if (r.pattern) {
        const w = r.pattern[0].length;
        if (r.pattern.some((row) => row.length !== w)) errors.push(`${where}: ragged pattern`);
        for (const ch of r.pattern.join('').replace(/ /g, '')) if (!(ch in r.key)) errors.push(`${where}: pattern char ${ch} has no key`);
      }
    }
  }

  // 7. sounds
  const sd = J.get(path.join(RP, 'sounds/sound_definitions.json'))?.sound_definitions ?? {};
  for (const [k, v] of Object.entries(sd)) for (const s of v.sounds ?? []) {
    const n = typeof s === 'string' ? s : s.name;
    if (!fs.existsSync(path.join(RP, `${n}.ogg`)) && !fs.existsSync(path.join(RP, `${n}.wav`))) errors.push(`sound ${k}: file ${n} missing`);
  }
  // scripts reference sounds that exist
  const script = fs.existsSync(path.join(BP, 'scripts/main.js')) ? fs.readFileSync(path.join(BP, 'scripts/main.js'), 'utf8') : '';
  for (const m of script.matchAll(/['"](craftoria\.[a-z_]+)['"]/g)) if (!sd[m[1]]) warnings.push(`script uses sound/id ${m[1]} not defined in sound_definitions`);
  for (const m of script.matchAll(/['"](animation\.craftoria\.[a-z_.]+)['"]/g)) if (!anims.has(m[1])) errors.push(`script plays missing animation ${m[1]}`);
  for (const m of script.matchAll(/['"]craftoria:([a-z_]+)['"]/g)) {
    const id = `craftoria:${m[1]}`;
    // states/properties/components also use the namespace; only flag ids that look like blocks/items/entities
    void id;
  }

  // 8. features
  for (const f of walk(path.join(BP, 'feature_rules'))) {
    const j = J.get(f);
    const pf = j?.['minecraft:feature_rules']?.description?.places_feature;
    const found = walk(path.join(BP, 'features')).some((ff) => JSON.stringify(J.get(ff) ?? {}).includes(`"${pf}"`));
    if (!found) errors.push(`feature rule places missing feature ${pf}`);
  }

  // 9. molang lint
  errors.push(...lintMolang(BP, RP));

  // 10. schema validation (optional)
  const schemaRoot = process.env.CRAFTORIA_SCHEMAS || '/tmp/bs1260/metadata/json_schemas';
  if (fs.existsSync(schemaRoot)) schemaValidate(schemaRoot, BP, J, errors, warnings);
  else warnings.push('Mojang JSON schemas not found: schema validation skipped');

  return { errors, warnings };
}

function schemaValidate(root, BP, J, errors, warnings) {
  let Ajv;
  try {
    Ajv = require('ajv');
  } catch {
    warnings.push('ajv not installed: schema validation skipped');
    return;
  }
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  const load = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  // blocks: format 1.21.110 document schema; components validated with the 1.26.0 component schema
  let blockDoc, blockComps;
  try {
    blockDoc = load('server/block/1.21.110/Blocks.json');
    blockComps = load('server/block_components/1.26.0/Block Components.json');
  } catch (e) {
    warnings.push(`block schemas unreadable: ${e.message}`);
    return;
  }
  const vComps = ajv.compile(blockComps);
  let checked = 0;
  for (const [f, j] of J) {
    if (!f.includes(`${path.sep}blocks${path.sep}`) || !j['minecraft:block']) continue;
    const blk = j['minecraft:block'];
    const id = blk.description.identifier;
    const strip = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('minecraft:') && k !== 'minecraft:tick' || k === 'minecraft:tick'));
    const sets = [['components', blk.components], ...(blk.permutations ?? []).map((p, i) => [`permutation ${i}`, p.components])];
    for (const [where, c] of sets) {
      const custom = Object.keys(c).filter((k) => !k.startsWith('minecraft:'));
      for (const k of custom) if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(k)) errors.push(`${id}: bad custom component name ${k}`);
      const ok = vComps(strip(c));
      checked++;
      if (!ok) for (const e of vComps.errors.slice(0, 5)) errors.push(`schema ${id} ${where}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
    }
    void blockDoc;
  }
  // items (1.26.0 item components schema)
  try {
    const itemComps = load('server/item/1.26.0/Components.json');
    const vItem = ajv.compile(itemComps);
    for (const [f, j] of J) {
      if (!j['minecraft:item']) continue;
      const it = j['minecraft:item'];
      const comps = Object.fromEntries(Object.entries(it.components).filter(([k]) => k.startsWith('minecraft:')));
      checked++;
      if (!vItem(comps)) for (const e of vItem.errors.slice(0, 5)) errors.push(`schema ${it.description.identifier}: ${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
    }
  } catch (e) {
    warnings.push(`item schema validation skipped: ${e.message}`);
  }
  warnings.push(`schema-validated ${checked} block/item component sets against Mojang 1.26.0 schemas`);
}

// ------------------------------------------------------------------ Molang lint
export function lintMolang(BP, RP) {
  const errors = [];
  const queries = new Set(fs.readFileSync(path.join(ROOT, 'tools/data/molang_queries.txt'), 'utf8').split('\n').filter(Boolean));
  const maths = new Set(fs.readFileSync(path.join(ROOT, 'tools/data/molang_math.txt'), 'utf8').split('\n').filter(Boolean));
  const exprs = []; // {where, text, entity}
  const add = (where, text, entity) => {
    if (typeof text === 'string' && /[a-z]\.[a-z_]/i.test(text)) exprs.push({ where, text, entity });
  };
  const visit = (x, where, entity) => {
    if (typeof x === 'string') add(where, x, entity);
    else if (Array.isArray(x)) x.forEach((y, i) => visit(y, `${where}[${i}]`, entity));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) visit(v, `${where}.${k}`, entity);
  };
  for (const f of walk(path.join(RP, 'animations'))) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [name, a] of Object.entries(j.animations ?? {})) {
      visit(a.bones ?? {}, name, name);
      if (a.anim_time_update) add(`${name}.anim_time_update`, a.anim_time_update, name);
    }
  }
  const entityVars = new Map(); // entity id -> assigned variables
  for (const f of walk(path.join(RP, 'entity'))) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'))['minecraft:client_entity'].description;
    const sc = d.scripts ?? {};
    for (const k of ['initialize', 'pre_animation']) for (const e of sc[k] ?? []) add(`${d.identifier}.${k}`, e, d.identifier);
    visit(sc.animate ?? [], `${d.identifier}.animate`, d.identifier);
    const assigned = new Set();
    for (const k of ['initialize', 'pre_animation']) for (const e of sc[k] ?? []) for (const m of e.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/gi)) assigned.add(m[1]);
    entityVars.set(d.identifier, { assigned, anims: Object.values(d.animations ?? {}) });
  }
  for (const f of walk(path.join(RP, 'render_controllers'))) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    visit(j.render_controllers, path.basename(f), null);
  }
  for (const f of walk(path.join(BP, 'blocks'))) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))['minecraft:block'];
    for (const p of j.permutations ?? []) add(`${j.description.identifier}.condition`, p.condition, null);
    const g = j.components['minecraft:geometry'];
    if (g && typeof g === 'object') visit(g.bone_visibility ?? {}, `${j.description.identifier}.bone_visibility`, null);
  }
  // which variables does each animation read? they must be assigned by the entity scripts or inside the expression
  const animEntity = new Map();
  for (const [eid, info] of entityVars) for (const a of info.anims) animEntity.set(a, eid);
  for (const { where, text, entity } of exprs) {
    let depth = 0;
    for (const ch of text) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) errors.push(`molang ${where}: unbalanced parentheses`);
    for (const m of text.matchAll(/\b(?:q|query)\.([a-z_0-9]+)/gi)) if (!queries.has(m[1].toLowerCase())) errors.push(`molang ${where}: unknown query ${m[1]}`);
    for (const m of text.matchAll(/\bmath\.([a-z_0-9]+)/gi)) if (!maths.has(m[1].toLowerCase())) errors.push(`molang ${where}: unknown math function ${m[1]}`);
    if (/\b(?:t|temp)\.[a-z]/i.test(text) && !/\b(?:t|temp)\.([a-z_0-9]+)\s*=(?!=)/i.test(text)) errors.push(`molang ${where}: temp variable read without assignment in the same expression`);
    const eid = entity && (entityVars.has(entity) ? entity : animEntity.get(entity));
    if (eid) {
      const assigned = new Set([...entityVars.get(eid).assigned, ...[...text.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/gi)].map((m) => m[1])]);
      for (const m of text.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)/gi)) if (!assigned.has(m[1])) errors.push(`molang ${where}: variable v.${m[1]} is never assigned`);
    }
  }
  return errors;
}
