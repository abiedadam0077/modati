// Crafting-table and furnace recipes (own recipe set, progression modelled on Create).
const C = (s) => (s.includes(':') ? s : `craftoria:${s}`);
const M = (s) => `minecraft:${s}`;
const STRIPPED = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'].map((w) => M(`stripped_${w}_log`)).concat([M('stripped_crimson_stem'), M('stripped_warped_stem')]);

function key(v) {
  if (v.startsWith('#')) return { tag: v.slice(1) };
  return { item: v };
}

export function shaped(id, pattern, keys, result, count = 1, unlock) {
  const k = {};
  for (const [ch, v] of Object.entries(keys)) k[ch] = key(v);
  const first = unlock ?? Object.values(keys)[0];
  return {
    file: id,
    json: {
      format_version: '1.20.10',
      'minecraft:recipe_shaped': {
        description: { identifier: `craftoria:${id}` },
        tags: ['crafting_table'],
        pattern,
        key: k,
        unlock: [first.startsWith('#') ? { item: M('crafting_table') } : { item: first }],
        result: { item: result, count },
      },
    },
  };
}

export function shapeless(id, ingredients, result, count = 1) {
  const first = ingredients[0];
  return {
    file: id,
    json: {
      format_version: '1.20.10',
      'minecraft:recipe_shapeless': {
        description: { identifier: `craftoria:${id}` },
        tags: ['crafting_table'],
        ingredients: ingredients.map(key),
        unlock: [first.startsWith('#') ? { item: M('crafting_table') } : { item: first }],
        result: { item: result, count },
      },
    },
  };
}

export function furnace(id, input, output, blast = true) {
  return {
    file: id,
    json: {
      format_version: '1.20.10',
      'minecraft:recipe_furnace': {
        description: { identifier: `craftoria:${id}` },
        tags: blast ? ['furnace', 'blast_furnace'] : ['furnace', 'smoker'],
        input: { item: input },
        output: { item: output },
      },
    },
  };
}

export function allRecipes() {
  const r = [];
  // materials
  r.push(shaped('andesite_alloy', ['AN', 'NA'], { A: M('andesite'), N: M('iron_nugget') }, C('andesite_alloy'), 1));
  r.push(shaped('andesite_alloy_from_zinc', ['AN', 'NA'], { A: M('andesite'), N: C('zinc_nugget') }, C('andesite_alloy'), 1));
  r.push(shaped('zinc_ingot_from_nuggets', ['NNN', 'NNN', 'NNN'], { N: C('zinc_nugget') }, C('zinc_ingot')));
  r.push(shapeless('zinc_nugget', [C('zinc_ingot')], C('zinc_nugget'), 9));
  r.push(shaped('zinc_block', ['III', 'III', 'III'], { I: C('zinc_ingot') }, C('zinc_block')));
  r.push(shapeless('zinc_ingot_from_block', [C('zinc_block')], C('zinc_ingot'), 9));
  r.push(shaped('brass_ingot_from_nuggets', ['NNN', 'NNN', 'NNN'], { N: C('brass_nugget') }, C('brass_ingot')));
  r.push(shapeless('brass_nugget', [C('brass_ingot')], C('brass_nugget'), 9));
  r.push(shaped('brass_block', ['III', 'III', 'III'], { I: C('brass_ingot') }, C('brass_block')));
  r.push(shapeless('brass_ingot_from_block', [C('brass_block')], C('brass_ingot'), 9));
  r.push(shapeless('copper_nugget', [M('copper_ingot')], C('copper_nugget'), 9));
  r.push(shaped('copper_ingot_from_nuggets', ['NNN', 'NNN', 'NNN'], { N: C('copper_nugget') }, M('copper_ingot')));
  r.push(shapeless('dough_by_hand', [C('wheat_flour'), M('water_bucket')], C('dough'), 1));
  // casings (also obtainable by using alloy/ingot on a stripped log, or with a deployer)
  STRIPPED.forEach((log, i) => {
    r.push(shapeless(`andesite_casing_${i}`, [log, C('andesite_alloy')], C('andesite_casing'), 1));
    r.push(shapeless(`brass_casing_${i}`, [log, C('brass_ingot')], C('brass_casing'), 1));
    r.push(shapeless(`copper_casing_${i}`, [log, M('copper_ingot')], C('copper_casing'), 1));
  });
  // kinetics
  r.push(shaped('shaft', ['A', 'A'], { A: C('andesite_alloy') }, C('shaft'), 8));
  r.push(shapeless('cogwheel', [C('shaft'), '#minecraft:planks'], C('cogwheel'), 1));
  r.push(shapeless('large_cogwheel', [C('shaft'), '#minecraft:planks', '#minecraft:planks'], C('large_cogwheel'), 1));
  r.push(shapeless('large_cogwheel_from_small', [C('cogwheel'), '#minecraft:planks'], C('large_cogwheel'), 1));
  r.push(shapeless('gearbox', [C('cogwheel'), C('andesite_casing')], C('gearbox'), 1));
  r.push(shapeless('clutch', [C('andesite_casing'), C('shaft'), M('redstone')], C('clutch'), 1));
  r.push(shapeless('gearshift', [C('andesite_casing'), C('cogwheel'), M('redstone')], C('gearshift'), 1));
  r.push(shaped('hand_crank', ['PPP', '  A'], { P: '#minecraft:planks', A: C('andesite_alloy') }, C('hand_crank'), 1, C('andesite_alloy')));
  r.push(shaped('water_wheel', ['PPP', 'PSP', 'PPP'], { P: '#minecraft:planks', S: C('shaft') }, C('water_wheel'), 1, C('shaft')));
  r.push(shaped('windmill_bearing', ['P', 'T', 'S'], { P: '#minecraft:planks', T: M('stone'), S: C('shaft') }, C('windmill_bearing'), 1, C('shaft')));
  r.push(shaped('mechanical_bearing', ['P', 'C', 'S'], { P: '#minecraft:planks', C: C('andesite_casing'), S: C('shaft') }, C('mechanical_bearing'), 1, C('andesite_casing')));
  r.push(shaped('sail_frame', ['SSS', 'SAS', 'SSS'], { S: M('stick'), A: C('andesite_alloy') }, C('sail_frame'), 8, C('andesite_alloy')));
  r.push(shapeless('sail', [C('sail_frame'), M('white_wool')], C('sail'), 1));
  r.push(shaped('speedometer', ['M', 'C'], { M: M('compass'), C: C('andesite_casing') }, C('speedometer'), 1, C('andesite_casing')));
  r.push(shapeless('stressometer', [C('speedometer'), M('compass'), M('redstone')], C('stressometer'), 1));
  // processing
  r.push(shaped('mechanical_press', ['S', 'C', 'I'], { S: C('shaft'), C: C('andesite_casing'), I: M('iron_block') }, C('mechanical_press'), 1, C('andesite_casing')));
  r.push(shaped('whisk', [' A ', 'I I', 'III'], { A: C('andesite_alloy'), I: C('iron_sheet') }, C('whisk'), 1, C('iron_sheet')));
  r.push(shaped('propeller', [' I ', 'IAI', ' I '], { I: C('iron_sheet'), A: C('andesite_alloy') }, C('propeller'), 1, C('iron_sheet')));
  r.push(shaped('mechanical_mixer', ['G', 'C', 'W'], { G: C('cogwheel'), C: C('andesite_casing'), W: C('whisk') }, C('mechanical_mixer'), 1, C('whisk')));
  r.push(shaped('millstone', ['G', 'A', 'S'], { G: C('cogwheel'), A: C('andesite_alloy'), S: M('stone') }, C('millstone'), 1, C('cogwheel')));
  r.push(shaped('crushing_wheel', ['SSS', 'SAS', 'SSS'], { S: M('cobblestone'), A: C('andesite_alloy') }, C('crushing_wheel'), 2, C('andesite_alloy')));
  r.push(shaped('mechanical_drill', [' A ', 'AIA', ' C '], { A: C('andesite_alloy'), I: M('iron_ingot'), C: C('andesite_casing') }, C('mechanical_drill'), 1, C('andesite_casing')));
  r.push(shaped('mechanical_saw', [' I ', 'IAI', ' C '], { I: C('iron_sheet'), A: C('andesite_alloy'), C: C('andesite_casing') }, C('mechanical_saw'), 1, C('andesite_casing')));
  r.push(shaped('brass_hand', [' A ', 'SSS', ' S '], { A: C('andesite_alloy'), S: C('brass_sheet') }, C('brass_hand'), 1, C('brass_sheet')));
  r.push(shapeless('electron_tube', [M('amethyst_shard'), M('redstone_torch'), C('iron_sheet')], C('electron_tube'), 1));
  r.push(shaped('precision_mechanism', [' C ', 'LGL', ' C '], { C: C('cogwheel'), L: C('large_cogwheel'), G: C('golden_sheet') }, C('precision_mechanism'), 1, C('golden_sheet')));
  r.push(shaped('deployer', ['E', 'C', 'H'], { E: C('electron_tube'), C: C('andesite_casing'), H: C('brass_hand') }, C('deployer'), 1, C('brass_hand')));
  r.push(shaped('depot', ['A', 'C'], { A: C('andesite_alloy'), C: C('andesite_casing') }, C('depot'), 1, C('andesite_casing')));
  r.push(shaped('basin', ['A A', 'AAA'], { A: C('andesite_alloy') }, C('basin'), 1, C('andesite_alloy')));
  r.push(shaped('encased_fan', ['S', 'C', 'P'], { S: C('shaft'), C: C('andesite_casing'), P: C('propeller') }, C('encased_fan'), 1, C('propeller')));
  // logistics
  r.push(shaped('belt_connector', ['KKK', 'KKK'], { K: M('dried_kelp') }, C('belt_connector'), 1));
  r.push(shaped('chute', ['S', 'I', 'S'], { S: C('iron_sheet'), I: M('iron_ingot') }, C('chute'), 4, C('iron_sheet')));
  r.push(shaped('andesite_funnel', ['A', 'K'], { A: C('andesite_alloy'), K: M('dried_kelp') }, C('andesite_funnel'), 2, C('andesite_alloy')));
  r.push(shaped('brass_funnel', ['B', 'E', 'K'], { B: C('brass_ingot'), E: C('electron_tube'), K: M('dried_kelp') }, C('brass_funnel'), 2, C('brass_ingot')));
  r.push(shaped('mechanical_arm', ['SSH', 'S  ', 'MC '], { S: C('brass_sheet'), H: C('brass_hand'), M: C('precision_mechanism'), C: C('brass_casing') }, C('mechanical_arm'), 1, C('precision_mechanism')));
  r.push(shaped('filter', ['NWN'], { N: M('iron_nugget'), W: M('white_wool') }, C('filter'), 1, M('white_wool')));
  // fluids
  r.push(shaped('fluid_pipe', ['SIS'], { S: C('copper_sheet'), I: M('copper_ingot') }, C('fluid_pipe'), 4, C('copper_sheet')));
  r.push(shaped('mechanical_pump', ['G', 'P'], { G: C('cogwheel'), P: C('fluid_pipe') }, C('mechanical_pump'), 1, C('fluid_pipe')));
  r.push(shaped('fluid_tank', ['S', 'B', 'S'], { S: C('copper_sheet'), B: M('barrel') }, C('fluid_tank'), 1, C('copper_sheet')));
  r.push(shaped('spout', ['C', 'K'], { C: C('copper_casing'), K: M('dried_kelp') }, C('spout'), 1, C('copper_casing')));
  // contraptions
  r.push(shaped('rope_pulley', ['C', 'W', 'I'], { C: C('andesite_casing'), W: M('white_wool'), I: C('iron_sheet') }, C('rope_pulley'), 1, C('andesite_casing')));
  r.push(shaped('mechanical_piston', ['P', 'C', 'V'], { P: '#minecraft:planks', C: C('andesite_casing'), V: M('piston') }, C('mechanical_piston'), 1, C('andesite_casing')));
  r.push(shaped('piston_pole', ['A', 'P', 'A'], { A: C('andesite_alloy'), P: '#minecraft:planks' }, C('piston_pole'), 8, C('andesite_alloy')));
  r.push(shapeless('super_glue', [M('slime_ball'), C('iron_sheet'), M('iron_nugget')], C('super_glue'), 1));
  r.push(shapeless('elevator_contact', [C('brass_casing'), M('redstone'), M('redstone_torch')], C('elevator_contact'), 1));
  // tools
  r.push(shaped('wrench', ['GG', 'GC', ' S'], { G: C('golden_sheet'), C: C('cogwheel'), S: M('stick') }, C('wrench'), 1, C('golden_sheet')));
  r.push(shaped('engineers_goggles', [' L ', 'GIG'], { L: M('leather'), G: M('glass'), I: M('gold_ingot') }, C('engineers_goggles'), 1, M('gold_ingot')));
  r.push(shapeless('engineers_manual', [M('book'), C('cogwheel')], C('engineers_manual'), 1));
  // trains
  r.push(shaped('track', ['I I', 'PPP'], { I: C('iron_sheet'), P: '#minecraft:planks' }, C('track'), 6, C('iron_sheet')));
  r.push(shaped('train_station', ['M', 'C'], { M: M('compass'), C: C('brass_casing') }, C('train_station'), 1, C('brass_casing')));
  r.push(shaped('train_signal', ['T', 'I', 'C'], { T: M('redstone_torch'), I: M('iron_ingot'), C: C('brass_casing') }, C('train_signal'), 2, C('brass_casing')));
  r.push(shaped('train_controls', ['L', 'C'], { L: M('lever'), C: C('brass_casing') }, C('train_controls'), 1, C('brass_casing')));
  r.push(shapeless('seat', [M('white_wool'), '#minecraft:planks'], C('seat'), 1));
  // furnace / blast furnace / smoker
  r.push(furnace('zinc_ingot_from_raw', C('raw_zinc'), C('zinc_ingot')));
  r.push(furnace('zinc_ingot_from_ore', C('zinc_ore'), C('zinc_ingot')));
  r.push(furnace('zinc_ingot_from_deepslate_ore', C('deepslate_zinc_ore'), C('zinc_ingot')));
  r.push(furnace('iron_from_crushed', C('crushed_raw_iron'), M('iron_ingot')));
  r.push(furnace('gold_from_crushed', C('crushed_raw_gold'), M('gold_ingot')));
  r.push(furnace('copper_from_crushed', C('crushed_raw_copper'), M('copper_ingot')));
  r.push(furnace('zinc_from_crushed', C('crushed_raw_zinc'), C('zinc_ingot')));
  r.push(furnace('bread_from_dough', C('dough'), M('bread'), false));
  return r;
}
