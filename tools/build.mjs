// CRAFTORIA: Mechanical Revolution — build script.
// Generates the behavior pack + resource pack from source (models, textures, JSON, scripts)
// and packages them into release/CRAFTORIA_Mechanical_Revolution.mcaddon
//   node tools/build.mjs            build + package
//   node tools/build.mjs --previews also render model previews into build/previews
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { build as esbuild } from 'esbuild';
import { BLOCK_MODELS } from './models/blocks.mjs';
import { ROTOR_MODELS } from './models/rotors.mjs';
import { BLOCKS, SIMPLE_BLOCKS } from './content/blocks.mjs';
import { ITEMS } from './content/items.mjs';
import { allRecipes } from './content/recipes.mjs';
import * as V from './content/visuals.mjs';
import * as icons from './lib/icons.mjs';
import { Image } from './lib/image.mjs';
import { geometryToQuads, renderQuads } from './lib/render.mjs';
import { CONTRAPTION_TEXTURES } from './content/contraption_textures.mjs';
import { soundDefinitions, SOUND_FILES } from './content/sounds.mjs';
import { LANG_EXTRA } from './content/lang.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'build');
const BP = path.join(OUT, 'CRAFTORIA_BP');
const RP = path.join(OUT, 'CRAFTORIA_RP');
const RELEASE = path.join(ROOT, 'release');
const VERSION = [1, 0, 0];
const MIN_ENGINE = [1, 26, 0];
const BLOCK_FORMAT = '1.21.110';
const ITEM_FORMAT = '1.21.110';
const PREVIEWS = process.argv.includes('--previews');

const UUID = {
  bpHeader: '6f1c3d2a-8b4e-4f7a-9c21-3e5d7a9b1c40',
  bpData: '0a7e5c13-2d4b-4e8f-b6a1-7c9d3e5f2a81',
  bpScript: 'c3b9e1f4-5a6d-4c2b-8e7f-1d3a5b7c9e02',
  rpHeader: '9d2f4b6a-1c3e-4a5b-8d7f-2e4c6a8b0d13',
  rpRes: '4e6a8c0b-3d5f-4b7a-9c1e-5f7b9d1a3c24',
};

const lang = new Map();
const terrain = {};
const itemTex = {};
const flipbooks = [];
const report = { blocks: 0, items: 0, entities: 0, recipes: 0, textures: 0, geometries: 0, animations: 0, sounds: 0 };

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
function writeTex(img, file) {
  img.save(file);
  report.textures++;
}

// ---------------------------------------------------------------------------------------------
// Blocks
const SOUND_BY_MATERIAL = { metal: 'metal', wood: 'wood', stone: 'stone', wool: 'cloth', glass: 'glass' };
const MAP_COLOR = { metal: '#a7a7a7', wood: '#8f7748', stone: '#707070', wool: '#e0e0e0', glass: '#c0e0ff' };

function orientPermutations(b) {
  const p = [];
  const T = (cond, rot) => p.push({ condition: cond, components: { 'minecraft:transformation': { rotation: rot } } });
  switch (b.orient) {
    case 'axis3':
      T("q.block_state('craftoria:axis') == 'x'", [0, 0, 90]);
      T("q.block_state('craftoria:axis') == 'z'", [90, 0, 0]);
      break;
    case 'haxis':
      if (b.authoredAxis === 'y') {
        T("q.block_state('craftoria:axis') == 'x'", [0, 0, 90]);
        T("q.block_state('craftoria:axis') == 'z'", [90, 0, 0]);
      } else T("q.block_state('craftoria:axis') == 'z'", [0, 90, 0]);
      break;
    case 'belt':
      T("q.block_state('craftoria:axis') == 'z'", [0, 90, 0]);
      break;
    case 'facing6':
      T("q.block_state('craftoria:facing') == 'down'", [180, 0, 0]);
      T("q.block_state('craftoria:facing') == 'north'", [-90, 0, 0]);
      T("q.block_state('craftoria:facing') == 'south'", [90, 0, 0]);
      T("q.block_state('craftoria:facing') == 'east'", [0, 0, -90]);
      T("q.block_state('craftoria:facing') == 'west'", [0, 0, 90]);
      break;
    case 'facing4':
      T("q.block_state('craftoria:facing') == 'west'", [0, 90, 0]);
      T("q.block_state('craftoria:facing') == 'south'", [0, 180, 0]);
      T("q.block_state('craftoria:facing') == 'east'", [0, -90, 0]);
      break;
    case 'track':
      T("q.block_state('craftoria:shape') == 'ew'", [0, 90, 0]);
      T("q.block_state('craftoria:shape') == 'es'", [0, -90, 0]);
      T("q.block_state('craftoria:shape') == 'sw'", [0, 180, 0]);
      T("q.block_state('craftoria:shape') == 'wn'", [0, 90, 0]);
      break;
    default:
  }
  return p;
}

function orientStates(b) {
  switch (b.orient) {
    case 'axis3': return { 'craftoria:axis': ['y', 'x', 'z'] };
    case 'haxis': return { 'craftoria:axis': ['x', 'z'] };
    case 'belt': return { 'craftoria:axis': ['x', 'z'] };
    case 'facing6': return { 'craftoria:facing': ['up', 'down', 'north', 'south', 'west', 'east'] };
    case 'facing4': return { 'craftoria:facing': ['north', 'south', 'west', 'east'] };
    default: return {};
  }
}

function destructible(b) {
  const seconds = b.hardness * 1.5;
  const tag = b.tool === 'axe' ? 'minecraft:is_axe' : 'minecraft:is_pickaxe';
  return {
    seconds_to_destroy: Math.round(seconds * 100) / 100,
    item_specific_speeds: [{ item: { tags: `q.any_tag('${tag}')` }, destroy_speed: Math.round(seconds * 0.25 * 100) / 100 }],
  };
}

function blockJson(b, geoId, texName) {
  const states = { ...orientStates(b), ...(b.states ?? {}) };
  if (b.rotor) states['craftoria:rotor'] = [false, true];
  const boneVis = { ...(b.boneVis ?? {}) };
  if (b.rotor) boneVis.moving = b.movingVis ? `!q.block_state('craftoria:rotor') && (${b.movingVis})` : "!q.block_state('craftoria:rotor')";
  const comps = {
    'minecraft:geometry': Object.keys(boneVis).length ? { identifier: geoId, bone_visibility: boneVis } : { identifier: geoId },
    'minecraft:material_instances': {
      '*': { texture: texName, render_method: b.render ?? 'opaque', ambient_occlusion: 1, face_dimming: true },
    },
    'minecraft:destructible_by_mining': destructible(b),
    'minecraft:destructible_by_explosion': { explosion_resistance: Math.max(3, b.hardness * 3) },
    'minecraft:light_dampening': b.light ?? 0,
    'minecraft:map_color': { color: MAP_COLOR[b.material] ?? '#808080' },
    'minecraft:movable': { movement_type: 'immovable' },
    'minecraft:collision_box': b.collision ?? true,
    'minecraft:selection_box': b.selection ?? true,
    'minecraft:tags': [b.tool === 'axe' ? 'minecraft:is_axe_item_destructible' : 'minecraft:is_pickaxe_item_destructible', 'craftoria:block'],
  };
  if (b.id === 'belt') {
    comps['minecraft:material_instances'].belt = { texture: 'craftoria_belt_still', render_method: 'opaque', ambient_occlusion: 1, face_dimming: true };
  }
  if (b.kinetic || b.machine || b.redstone) {
    comps['minecraft:tick'] = { interval_range: b.redstone ? [4, 4] : [40, 40], looping: true };
  }
  if (b.kinetic) comps['craftoria:kinetic'] = {};
  if (b.machine || b.interact || b.kinetic) comps['craftoria:machine'] = {};
  if (b.orient && b.orient !== 'none' && b.orient !== 'track') comps['craftoria:orient'] = { mode: b.orient };
  if (b.waterlog) comps['minecraft:liquid_detection'] = { detection_rules: [{ liquid_type: 'water', can_contain_liquid: true, on_liquid_touches: 'no_reaction' }] };
  if (b.flammable) comps['minecraft:flammable'] = { catch_chance_modifier: 5, destroy_chance_modifier: 20 };
  if (b.redstoneSource) comps['minecraft:redstone_conductivity'] = { redstone_conductor: false };

  const permutations = orientPermutations(b);
  if (b.id === 'belt') {
    // motion state selects the scrolling texture: 0 stopped, 1-4 forward tiers, 5-8 backward tiers
    for (let m = 1; m <= 8; m++) {
      permutations.push({
        condition: `q.block_state('craftoria:motion') == ${m}`,
        components: { 'minecraft:material_instances': { '*': { texture: texName, render_method: 'opaque' }, belt: { texture: `craftoria_belt_${m}`, render_method: 'opaque' } } },
      });
    }
  }
  const json = {
    format_version: BLOCK_FORMAT,
    'minecraft:block': {
      description: {
        identifier: `craftoria:${b.id}`,
        menu_category: b.noItem ? { category: 'none' } : { category: b.category ?? 'construction' },
        ...(Object.keys(states).length ? { states } : {}),
      },
      components: comps,
      ...(permutations.length ? { permutations } : {}),
    },
  };
  return json;
}

function buildBlocks() {
  for (const b of BLOCKS) {
    const model = BLOCK_MODELS[b.model]();
    model.identifier = `geometry.craftoria.${b.id}`;
    const { atlas } = model.bake(b.id);
    write(path.join(RP, 'models/blocks', `${b.id}.geo.json`), model.toGeometry());
    report.geometries++;
    writeTex(atlas, path.join(RP, 'textures/blocks/craftoria', `${b.id}.png`));
    const tex = `craftoria_${b.id}`;
    terrain[tex] = { textures: `textures/blocks/craftoria/${b.id}` };
    write(path.join(BP, 'blocks', `${b.id}.json`), blockJson(b, model.identifier, tex));
    lang.set(`tile.craftoria:${b.id}.name`, b.name);
    report.blocks++;
    if (PREVIEWS) previewModel(model, atlas, `block_${b.id}`);
  }
  // simple full blocks
  const simpleTex = {
    casing_andesite: () => icons.casingTexture('andesite', 'wood'),
    casing_brass: () => icons.casingTexture('brass', 'wood_dark'),
    casing_copper: () => icons.casingTexture('copper', 'wood'),
    zinc_ore: () => icons.oreTexture('stone', 'zinc'),
    deepslate_zinc_ore: () => icons.oreTexture('andesite_dark', 'zinc', true),
    zinc_block: () => icons.metalBlockTexture('zinc'),
    brass_block: () => icons.metalBlockTexture('brass'),
  };
  for (const b of SIMPLE_BLOCKS) {
    writeTex(simpleTex[b.texture](), path.join(RP, 'textures/blocks/craftoria', `${b.texture}.png`));
    const tex = `craftoria_${b.texture}`;
    terrain[tex] = { textures: `textures/blocks/craftoria/${b.texture}` };
    const comps = {
      'minecraft:geometry': 'minecraft:geometry.full_block',
      'minecraft:material_instances': { '*': { texture: tex, render_method: 'opaque' } },
      'minecraft:destructible_by_mining': destructible(b),
      'minecraft:destructible_by_explosion': { explosion_resistance: b.hardness * 3 },
      'minecraft:map_color': { color: MAP_COLOR[b.material] ?? '#808080' },
      'minecraft:tags': [b.tool === 'axe' ? 'minecraft:is_axe_item_destructible' : 'minecraft:is_pickaxe_item_destructible', 'craftoria:block'],
    };
    if (b.loot) comps['minecraft:loot'] = `loot_tables/blocks/craftoria/${b.loot}.json`;
    write(path.join(BP, 'blocks', `${b.id}.json`), {
      format_version: BLOCK_FORMAT,
      'minecraft:block': { description: { identifier: `craftoria:${b.id}`, menu_category: { category: b.material === 'stone' && b.loot ? 'nature' : 'construction' } }, components: comps },
    });
    lang.set(`tile.craftoria:${b.id}.name`, b.name);
    report.blocks++;
  }
  // belt flipbooks: tiers 1..4 forward, 5..8 backward (px per frame 1,2,4,8)
  const steps = [1, 2, 4, 8];
  for (let i = 0; i < 4; i++) {
    for (const [dirSign, m] of [[1, i + 1], [-1, i + 5]]) {
      const { img } = icons.beltFlipbook(steps[i], dirSign);
      writeTex(img, path.join(RP, 'textures/blocks/craftoria', `belt_${m}.png`));
      terrain[`craftoria_belt_${m}`] = { textures: `textures/blocks/craftoria/belt_${m}` };
      flipbooks.push({ flipbook_texture: `textures/blocks/craftoria/belt_${m}`, atlas_tile: `craftoria_belt_${m}`, ticks_per_frame: 1, blend_frames: false });
    }
  }
  const still = icons.beltFlipbook(16, 1).img;
  writeTex(still, path.join(RP, 'textures/blocks/craftoria', 'belt_still.png'));
  terrain.craftoria_belt_still = { textures: 'textures/blocks/craftoria/belt_still' };
}

// ---------------------------------------------------------------------------------------------
// Items
function buildItems() {
  for (const it of ITEMS) {
    writeTex(it.icon(), path.join(RP, 'textures/items/craftoria', `${it.id}.png`));
    itemTex[`craftoria_${it.id}`] = { textures: `textures/items/craftoria/${it.id}` };
    const comps = {
      'minecraft:icon': { textures: { default: `craftoria_${it.id}` } },
      'minecraft:display_name': { value: `item.craftoria:${it.id}.name` },
      'minecraft:max_stack_size': it.stack ?? 64,
      'minecraft:tags': { tags: ['craftoria:item'] },
    };
    if (it.hand) comps['minecraft:hand_equipped'] = true;
    if (it.wearable) comps['minecraft:wearable'] = { slot: it.wearable, protection: 1 };
    if (it.durability) comps['minecraft:durability'] = { max_durability: it.durability };
    if (it.use) {
      comps['craftoria:tool'] = {};
      comps['minecraft:interact_button'] = true;
    }
    write(path.join(BP, 'items', `${it.id}.json`), {
      format_version: ITEM_FORMAT,
      'minecraft:item': {
        description: { identifier: `craftoria:${it.id}`, menu_category: { category: it.use || it.wearable ? 'equipment' : 'items' } },
        components: comps,
      },
    });
    lang.set(`item.craftoria:${it.id}.name`, it.name);
    report.items++;
  }
}

// ---------------------------------------------------------------------------------------------
// Entities / visuals
function buildVisuals() {
  const models = [];
  const names = ['shaft', 'cog', 'large_cog', 'gearbox', 'split', 'crank', 'motor', 'water_wheel', 'press', 'mixer', 'millstone', 'crushing_wheel', 'drill', 'saw', 'deployer', 'arm', 'fan', 'pump', 'bearing', 'rope_pulley', 'gauge', 'windmill_bearing', 'belt_pulley', 'piston', 'clutch', 'gearshift'];
  ROTOR_MODELS.forEach((fn, index) => {
    const model = fn();
    const name = names[index];
    model.identifier = `geometry.craftoria.rotor_${name}`;
    const { atlas } = model.bake(`rotor_${name}`);
    write(path.join(RP, 'models/entity', `rotor_${name}.geo.json`), model.toGeometry());
    report.geometries++;
    writeTex(atlas, path.join(RP, 'textures/entity/craftoria', `rotor_${name}.png`));
    models.push({ index, name });
    if (PREVIEWS) previewModel(model, atlas, `rotor_${name}`);
  });
  write(path.join(BP, 'entities', 'rotor.json'), V.rotorBehavior());
  write(path.join(RP, 'entity', 'rotor.entity.json'), V.rotorClient(models));
  write(path.join(RP, 'render_controllers', 'rotor.render_controllers.json'), V.rotorRenderController(models));
  write(path.join(RP, 'animations', 'rotor.animation.json'), V.rotorAnimations());
  report.animations += Object.keys(V.rotorAnimations().animations).length;
  lang.set('entity.craftoria:rotor.name', 'Kinetic Part');

  // item display
  write(path.join(BP, 'entities', 'item_display.json'), V.itemDisplayBehavior());
  write(path.join(RP, 'entity', 'item_display.entity.json'), V.itemDisplayClient());
  write(path.join(RP, 'models/entity', 'item_display.geo.json'), V.itemDisplayGeometry());
  write(path.join(RP, 'animations', 'item_display.animation.json'), V.itemDisplayAnimations());
  write(path.join(RP, 'render_controllers', 'item_display.render_controllers.json'), V.itemDisplayRenderController());
  writeTex(new Image(16, 16), path.join(RP, 'textures/entity/craftoria', 'item_display.png'));
  lang.set('entity.craftoria:item_display.name', 'Item');
  report.animations++;

  // block display (contraptions): custom geometries from our block models
  const texList = [];
  const customGeos = [];
  let ti = 1;
  for (const t of CONTRAPTION_TEXTURES.vanilla) {
    texList.push({ index: ti, path: t.path });
    t.index = ti++;
  }
  const custom = CONTRAPTION_TEXTURES.custom;
  let gi = 2;
  for (const c of custom) {
    const model = BLOCK_MODELS[c.model]();
    model.kind = 'entity';
    model.identifier = `geometry.craftoria.bd_${c.model}`;
    for (const bn of model.bones) {
      if (!bn.parent) bn.parent = 'block';
    }
    model.bones.unshift(new (model.bones[0].constructor)('block', { parent: 'spin', pivot: [0, 8, 0] }));
    model.bones.unshift(new (model.bones[0].constructor)('spin', { parent: 'orient', pivot: [0, 0, 0] }));
    model.bones.unshift(new (model.bones[0].constructor)('orient', { parent: 'root', pivot: [0, 0, 0] }));
    model.bones.unshift(new (model.bones[0].constructor)('root', { pivot: [0, 0, 0] }));
    model.opts.visibleBounds = [48, 48, 0];
    const { atlas } = model.bake(`bd_${c.model}`);
    write(path.join(RP, 'models/entity', `bd_${c.model}.geo.json`), model.toGeometry());
    writeTex(atlas, path.join(RP, 'textures/entity/craftoria', `bd_${c.model}.png`));
    texList.push({ index: ti, path: `textures/entity/craftoria/bd_${c.model}` });
    customGeos.push({ index: gi, name: c.model, texIndex: ti });
    c.geo = gi++;
    ti++;
    report.geometries++;
  }
  // casings as plain cubes with our own textures
  for (const s of CONTRAPTION_TEXTURES.ownCubes) {
    texList.push({ index: ti, path: `textures/blocks/craftoria/${s.texture}` });
    s.index = ti++;
  }
  const cubes = V.blockDisplayCubeGeometries();
  // extend cube geometry with the shared hierarchy root>orient>spin>block
  for (const g of [cubes.side, cubes.cap]) {
    const bones = g['minecraft:geometry'][0].bones;
    bones.splice(1, 0, { name: 'orient', parent: 'root', pivot: [0, 0, 0] }, { name: 'spin', parent: 'orient', pivot: [0, 0, 0] });
    bones.find((b) => b.name === 'block').parent = 'spin';
    g['minecraft:geometry'][0].description.visible_bounds_width = 48;
    g['minecraft:geometry'][0].description.visible_bounds_height = 48;
  }
  write(path.join(RP, 'models/entity', 'bd_cube_side.geo.json'), cubes.side);
  write(path.join(RP, 'models/entity', 'bd_cube_cap.geo.json'), cubes.cap);
  write(path.join(BP, 'entities', 'block_display.json'), V.blockDisplayBehavior());
  write(path.join(RP, 'entity', 'block_display.entity.json'), V.blockDisplayClient(texList, customGeos));
  write(path.join(RP, 'render_controllers', 'block_display.render_controllers.json'), V.blockDisplayRenderControllers(texList, customGeos));
  write(path.join(RP, 'animations', 'block_display.animation.json'), blockDisplayAnimationJson());
  lang.set('entity.craftoria:block_display.name', 'Moving Block');
  report.animations++;
  // emit the runtime lookup table for scripts
  const table = {
    vanilla: Object.fromEntries(CONTRAPTION_TEXTURES.vanilla.flatMap((t) => t.blocks.map((id) => [id, [t.index, t.top ? CONTRAPTION_TEXTURES.vanilla.find((x) => x.path === t.top)?.index ?? t.index : t.index]]))),
    own: Object.fromEntries(CONTRAPTION_TEXTURES.ownCubes.map((s) => [s.block, s.index])),
    custom: Object.fromEntries(custom.map((c) => [c.block, c.geo])),
  };
  write(path.join(ROOT, 'src/scripts/generated/contraption_table.ts'), `// AUTO-GENERATED by tools/build.mjs — do not edit\nexport const CONTRAPTION_TABLE: { vanilla: Record<string, [number, number]>; own: Record<string, number>; custom: Record<string, number> } = ${JSON.stringify(table)};\n`);

  // seat
  write(path.join(BP, 'entities', 'seat.json'), V.seatBehavior());
  write(path.join(RP, 'entity', 'seat.entity.json'), V.seatClient());
  lang.set('entity.craftoria:seat_entity.name', 'Seat');
  lang.set('action.interact.ride.craftoria_seat', 'Sit');
  report.entities += 4;
}

function blockDisplayAnimationJson() {
  return {
    format_version: '1.8.0',
    animations: {
      'animation.craftoria.block_display.pose': {
        loop: true,
        bones: {
          root: { rotation: [0, '-q.body_y_rotation', 0] },
          orient: { rotation: ['v.ox', 0, 'v.oz'] },
          spin: { rotation: [0, '-v.ang', 0] },
          block: {
            position: ["q.property('craftoria:ox')", "q.property('craftoria:oy')", "q.property('craftoria:oz')"],
            rotation: ['v.bx', 0, 'v.bz'],
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
function previewModel(model, atlas, name) {
  const geo = model.toGeometry();
  const quads = geometryToQuads(geo, model.kind);
  const dir = path.join(OUT, 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const size = 160;
  const a = renderQuads(quads, { default: atlas, belt: icons.beltFlipbook(16, 1).img }, { view: 'se', size, scale: 4.2 });
  const b = renderQuads(quads, { default: atlas, belt: icons.beltFlipbook(16, 1).img }, { view: 'nw', size, scale: 4.2 });
  const img = new Image(size * 2, size);
  img.blit(a, 0, 0);
  img.blit(b, size, 0);
  img.save(path.join(dir, `${name}.png`));
}

// ---------------------------------------------------------------------------------------------
function buildMisc() {
  // manifests
  write(path.join(BP, 'manifest.json'), {
    format_version: 2,
    header: {
      name: 'CRAFTORIA: Mechanical Revolution §8[BP]',
      description: 'Kinetic machines, processing, logistics and contraptions for Bedrock 1.26+. Requires the CRAFTORIA resource pack.',
      uuid: UUID.bpHeader,
      version: VERSION,
      min_engine_version: MIN_ENGINE,
    },
    modules: [
      { type: 'data', uuid: UUID.bpData, version: VERSION },
      { type: 'script', language: 'javascript', uuid: UUID.bpScript, version: VERSION, entry: 'scripts/main.js' },
    ],
    dependencies: [
      { uuid: UUID.rpHeader, version: VERSION },
      { module_name: '@minecraft/server', version: '2.5.0' },
      { module_name: '@minecraft/server-ui', version: '2.0.0' },
    ],
    metadata: { authors: ['CRAFTORIA Team'], license: 'MIT (code). Inspired by the Create mod (MIT code); no Create assets are used.', product_type: 'addon' },
  });
  write(path.join(RP, 'manifest.json'), {
    format_version: 2,
    header: {
      name: 'CRAFTORIA: Mechanical Revolution §8[RP]',
      description: 'Models, textures, animations and sounds for CRAFTORIA.',
      uuid: UUID.rpHeader,
      version: VERSION,
      min_engine_version: MIN_ENGINE,
    },
    modules: [{ type: 'resources', uuid: UUID.rpRes, version: VERSION }],
    dependencies: [{ uuid: UUID.bpHeader, version: VERSION }],
    metadata: { authors: ['CRAFTORIA Team'], product_type: 'addon' },
  });
  const icon = packIcon();
  writeTex(icon, path.join(BP, 'pack_icon.png'));
  writeTex(icon, path.join(RP, 'pack_icon.png'));

  write(path.join(RP, 'textures', 'terrain_texture.json'), { resource_pack_name: 'craftoria', texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: terrain });
  write(path.join(RP, 'textures', 'item_texture.json'), { resource_pack_name: 'craftoria', texture_name: 'atlas.items', texture_data: itemTex });
  write(path.join(RP, 'textures', 'flipbook_textures.json'), flipbooks);

  // recipes
  for (const r of allRecipes()) {
    write(path.join(BP, 'recipes', `${r.file}.json`), r.json);
    report.recipes++;
  }
  // loot
  write(path.join(BP, 'loot_tables/blocks/craftoria', 'zinc_ore.json'), {
    pools: [{ rolls: 1, entries: [{ type: 'item', name: 'craftoria:raw_zinc', weight: 1, functions: [{ function: 'set_count', count: { min: 1, max: 1 } }, { function: 'explosion_decay' }] }] }],
  });
  // world generation (stable feature + feature rule)
  write(path.join(BP, 'features', 'zinc_ore_feature.json'), {
    format_version: '1.13.0',
    'minecraft:ore_feature': {
      description: { identifier: 'craftoria:zinc_ore_feature' },
      count: 8,
      replace_rules: [
        { places_block: 'craftoria:zinc_ore', may_replace: ['minecraft:stone', 'minecraft:granite', 'minecraft:diorite', 'minecraft:andesite', 'minecraft:tuff'] },
        { places_block: 'craftoria:deepslate_zinc_ore', may_replace: ['minecraft:deepslate'] },
      ],
    },
  });
  write(path.join(BP, 'feature_rules', 'zinc_ore_rule.json'), {
    format_version: '1.13.0',
    'minecraft:feature_rules': {
      description: { identifier: 'craftoria:zinc_ore_rule', places_feature: 'craftoria:zinc_ore_feature' },
      conditions: { placement_pass: 'underground_pass', 'minecraft:biome_filter': [{ test: 'has_biome_tag', operator: '==', value: 'overworld' }] },
      distribution: {
        iterations: 8,
        coordinate_eval_order: 'zyx',
        x: { distribution: 'uniform', extent: [0, 16] },
        y: { distribution: 'triangle', extent: [-63, 70] },
        z: { distribution: 'uniform', extent: [0, 16] },
      },
    },
  });
  // sounds
  write(path.join(RP, 'sounds', 'sound_definitions.json'), soundDefinitions());
  for (const f of SOUND_FILES) {
    const src = path.join(ROOT, 'assets/sounds', `${f}.ogg`);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(RP, 'sounds/craftoria'), { recursive: true });
      fs.copyFileSync(src, path.join(RP, 'sounds/craftoria', `${f}.ogg`));
      report.sounds++;
    } else {
      throw new Error(`missing sound asset ${src} (run: python3 tools/sounds/generate_sounds.py)`);
    }
  }
  // languages
  for (const [k, v] of Object.entries(LANG_EXTRA)) lang.set(k, v);
  const langText = [...lang.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  write(path.join(RP, 'texts', 'en_US.lang'), langText);
  write(path.join(RP, 'texts', 'languages.json'), ['en_US']);
  write(path.join(BP, 'texts', 'en_US.lang'), 'pack.name=CRAFTORIA: Mechanical Revolution\npack.description=Kinetic machines for Bedrock\n');
  write(path.join(BP, 'texts', 'languages.json'), ['en_US']);
}

function packIcon() {
  const img = new Image(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = y / 63;
    img.set(x, y, [Math.round(40 + 30 * t), Math.round(32 + 20 * t), Math.round(26 + 10 * t), 255]);
  }
  const brass = [[110, 74, 28], [165, 114, 44], [212, 162, 69], [236, 199, 103], [251, 230, 160]];
  const cx = 32, cy = 32;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const tooth = Math.cos(a * 10) > 0.3 ? 26 : 22;
    if (r < tooth && r > 8) {
      const l = (dx + dy) / 40;
      const k = l < -0.35 ? 4 : l < 0 ? 3 : l < 0.35 ? 2 : 1;
      img.set(x, y, [...brass[k], 255]);
    } else if (r <= 8 && r > 5) img.set(x, y, [...brass[0], 255]);
  }
  return img;
}

async function bundleScripts() {
  await esbuild({
    entryPoints: [path.join(ROOT, 'src/scripts/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: path.join(BP, 'scripts', 'main.js'),
    external: ['@minecraft/server', '@minecraft/server-ui'],
    minify: false,
    legalComments: 'inline',
    banner: { js: '// CRAFTORIA: Mechanical Revolution — generated from src/scripts (TypeScript). Kinetic logic adapted from Create (MIT).' },
    logLevel: 'error',
  });
}

function packageAddon() {
  fs.mkdirSync(RELEASE, { recursive: true });
  const out = path.join(RELEASE, 'CRAFTORIA_Mechanical_Revolution_v1.0.0.mcaddon');
  fs.rmSync(out, { force: true });
  execSync(`cd "${OUT}" && zip -q -r -9 -X "${out}" CRAFTORIA_BP CRAFTORIA_RP`);
  return out;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  fs.rmSync(BP, { recursive: true, force: true });
  fs.rmSync(RP, { recursive: true, force: true });
  if (PREVIEWS) fs.rmSync(path.join(OUT, 'previews'), { recursive: true, force: true });
  buildBlocks();
  buildItems();
  buildVisuals();
  buildMisc();
  await bundleScripts();
  const { validate } = await import('./validate.mjs');
  const problems = validate(BP, RP);
  if (problems.errors.length) {
    console.error('VALIDATION ERRORS:\n' + problems.errors.join('\n'));
    process.exit(1);
  }
  if (problems.warnings.length) console.warn('Warnings:\n' + problems.warnings.join('\n'));
  const out = packageAddon();
  const size = fs.statSync(out).size;
  console.log(`Built in ${Date.now() - t0} ms ->`, path.relative(ROOT, out), `(${(size / 1024).toFixed(1)} KB)`);
  console.log(JSON.stringify(report));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
