// Moving-block rendering table for contraptions.
// Vanilla blocks are drawn with the game's own textures referenced by path (nothing is copied);
// every path is checked against tools/data/vanilla_block_textures.txt by the validator.
const v = (path, blocks, top) => ({ path: `textures/blocks/${path}`, blocks: blocks.map((b) => `minecraft:${b}`), top: top ? `textures/blocks/${top}` : undefined });

const WOODS = [
  ['oak', 'planks_oak', 'log_oak', 'log_oak_top'],
  ['spruce', 'planks_spruce', 'log_spruce', 'log_spruce_top'],
  ['birch', 'planks_birch', 'log_birch', 'log_birch_top'],
  ['jungle', 'planks_jungle', 'log_jungle', 'log_jungle_top'],
  ['acacia', 'planks_acacia', 'log_acacia', 'log_acacia_top'],
  ['dark_oak', 'planks_big_oak', 'log_big_oak', 'log_big_oak_top'],
];

const vanilla = [];
for (const [w, planks, log, top] of WOODS) {
  vanilla.push(v(planks, [`${w}_planks`]));
  vanilla.push(v(top, []));
  vanilla.push(v(log, [`${w}_log`, `${w}_wood`], top));
}
vanilla.push(
  v('cherry_planks', ['cherry_planks']),
  v('mangrove_planks', ['mangrove_planks']),
  v('bamboo_planks', ['bamboo_planks']),
  v('stone', ['stone']),
  v('cobblestone', ['cobblestone']),
  v('stonebrick', ['stone_bricks']),
  v('stone_andesite', ['andesite']),
  v('stone_granite', ['granite']),
  v('stone_diorite', ['diorite']),
  v('glass', ['glass']),
  v('iron_block', ['iron_block']),
  v('gold_block', ['gold_block']),
  v('diamond_block', ['diamond_block']),
  v('emerald_block', ['emerald_block']),
  v('lapis_block', ['lapis_block']),
  v('redstone_block', ['redstone_block']),
  v('coal_block', ['coal_block']),
  v('copper_block', ['copper_block']),
  v('brick', ['brick_block']),
  v('dirt', ['dirt']),
  v('sand', ['sand']),
  v('red_sand', ['red_sand']),
  v('gravel', ['gravel']),
  v('clay', ['clay']),
  v('snow', ['snow']),
  v('ice', ['ice']),
  v('obsidian', ['obsidian']),
  v('netherrack', ['netherrack']),
  v('nether_brick', ['nether_brick']),
  v('end_bricks', ['end_bricks']),
  v('purpur_block', ['purpur_block']),
  v('prismarine_rough', ['prismarine']),
  v('glowstone', ['glowstone']),
  v('sea_lantern', ['sea_lantern']),
  v('redstone_lamp_off', ['redstone_lamp']),
  v('hardened_clay', ['hardened_clay']),
  v('mud_bricks', ['mud_bricks']),
  v('tuff', ['tuff']),
  v('calcite', ['calcite']),
  v('blackstone', ['blackstone']),
  v('polished_blackstone_bricks', ['polished_blackstone_bricks']),
  v('bookshelf', ['bookshelf'], 'planks_oak'),
  v('stone_slab_top', []),
  v('stone_slab_side', ['smooth_stone'], 'stone_slab_top'),
  v('quartz_block_top', []),
  v('quartz_block_side', ['quartz_block'], 'quartz_block_top'),
  v('sandstone_top', []),
  v('sandstone_normal', ['sandstone'], 'sandstone_top'),
  v('hay_block_top', []),
  v('hay_block_side', ['hay_block'], 'hay_block_top'),
);
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const COLOR_ID = { silver: 'light_gray' };
for (const c of COLORS) {
  const id = COLOR_ID[c] ?? c;
  vanilla.push(v(`wool_colored_${c}`, [`${id}_wool`]));
  vanilla.push(v(`concrete_${c}`, [`${id}_concrete`]));
}

export const CONTRAPTION_TEXTURES = {
  vanilla,
  // CRAFTORIA blocks with dedicated geometry while moving
  custom: [
    { block: 'craftoria:sail', model: 'sail' },
    { block: 'craftoria:sail_frame', model: 'sail_frame' },
    { block: 'craftoria:piston_pole', model: 'piston_pole' },
    { block: 'craftoria:seat', model: 'seat' },
    { block: 'craftoria:train_controls', model: 'train_controls' },
    { block: 'craftoria:depot', model: 'depot' },
    { block: 'craftoria:basin', model: 'basin' },
    { block: 'craftoria:chute', model: 'chute' },
  ],
  // CRAFTORIA full cubes
  ownCubes: [
    { block: 'craftoria:andesite_casing', texture: 'casing_andesite' },
    { block: 'craftoria:brass_casing', texture: 'casing_brass' },
    { block: 'craftoria:copper_casing', texture: 'casing_copper' },
    { block: 'craftoria:zinc_block', texture: 'zinc_block' },
    { block: 'craftoria:brass_block', texture: 'brass_block' },
  ],
};
