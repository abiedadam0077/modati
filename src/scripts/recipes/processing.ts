// Processing recipes for CRAFTORIA machines (own recipe set; structure and several values are
// inspired by Create's MIT-licensed recipe data: press/millstone/crushing/mixing/cutting/deploying).
import { SItem, hasTag } from '../util/items';

export type FluidId = 'water' | 'lava' | 'milk' | 'honey';
export interface Ingredient {
  id?: string;
  tag?: string;
  n?: number;
}
export interface Output {
  id: string;
  n: number;
  chance?: number;
}
export interface ItemRecipe {
  in: Ingredient;
  out: Output[];
  /** processing time in ticks at the reference speed */
  time: number;
}
export interface BasinRecipe {
  items: Ingredient[];
  fluids?: { f: FluidId; mb: number }[];
  out: Output[];
  outFluid?: { f: FluidId; mb: number };
  heat?: boolean;
  time: number;
}
export interface DeployRecipe {
  target: Ingredient;
  held: Ingredient;
  out: Output[];
  keepHeld?: boolean;
}
export interface FillRecipe {
  target: Ingredient;
  fluid: { f: FluidId; mb: number };
  out: Output[];
}

const M = (s: string) => `minecraft:${s}`;
const C = (s: string) => `craftoria:${s}`;
const o = (id: string, n = 1, chance?: number): Output => (chance === undefined ? { id, n } : { id, n, chance });
const i = (id: string, n = 1): Ingredient => ({ id, n });

export const PRESSING: ItemRecipe[] = [
  { in: i(M('iron_ingot')), out: [o(C('iron_sheet'))], time: 1 },
  { in: i(M('copper_ingot')), out: [o(C('copper_sheet'))], time: 1 },
  { in: i(M('gold_ingot')), out: [o(C('golden_sheet'))], time: 1 },
  { in: i(C('brass_ingot')), out: [o(C('brass_sheet'))], time: 1 },
  { in: i(M('sugar_cane')), out: [o(M('paper'))], time: 1 },
  ...['dirt', 'coarse_dirt', 'podzol', 'mycelium', 'grass_block'].map((d) => ({ in: i(M(d)), out: [o(M('grass_path'))], time: 1 })),
];

export const COMPACTING: BasinRecipe[] = [
  { items: [i(M('iron_nugget'), 9)], out: [o(M('iron_ingot'))], time: 1 },
  { items: [i(M('gold_nugget'), 9)], out: [o(M('gold_ingot'))], time: 1 },
  { items: [i(C('copper_nugget'), 9)], out: [o(M('copper_ingot'))], time: 1 },
  { items: [i(C('zinc_nugget'), 9)], out: [o(C('zinc_ingot'))], time: 1 },
  { items: [i(C('brass_nugget'), 9)], out: [o(C('brass_ingot'))], time: 1 },
  { items: [i(M('snowball'), 4)], out: [o(M('snow'))], time: 1 },
  { items: [i(M('snow'), 9)], out: [o(M('ice'))], time: 1 },
  { items: [i(M('clay_ball'), 4)], out: [o(M('clay'))], time: 1 },
  { items: [i(M('dried_kelp'), 9)], out: [o(M('dried_kelp_block'))], time: 1 },
  { items: [i(M('flint'), 2), i(M('gravel'))], fluids: [{ f: 'lava', mb: 100 }], out: [o(M('andesite'))], time: 1 },
  { items: [i(M('flint'), 2), i(M('calcite'))], fluids: [{ f: 'lava', mb: 100 }], out: [o(M('diorite'))], time: 1 },
  { items: [i(M('flint'), 2), i(M('red_sand'))], fluids: [{ f: 'lava', mb: 100 }], out: [o(M('granite'))], time: 1 },
];

export const MILLING: ItemRecipe[] = [
  { in: i(M('wheat')), out: [o(C('wheat_flour')), o(C('wheat_flour'), 2, 0.25), o(M('wheat_seeds'), 1, 0.25)], time: 150 },
  { in: i(M('cobblestone')), out: [o(M('gravel'))], time: 250 },
  { in: i(M('gravel')), out: [o(M('flint'))], time: 250 },
  { in: i(M('sandstone')), out: [o(M('sand'))], time: 150 },
  { in: i(M('andesite')), out: [o(M('cobblestone'))], time: 200 },
  { in: i(M('granite')), out: [o(M('red_sand'))], time: 200 },
  { in: i(M('hardened_clay')), out: [o(M('red_sand'))], time: 200 },
  { in: i(M('bone')), out: [o(M('bone_meal'), 3), o(M('white_dye'), 1, 0.25), o(M('bone_meal'), 3, 0.25)], time: 100 },
  { in: i(M('bone_meal')), out: [o(M('white_dye'), 2), o(M('light_gray_dye'), 1, 0.1)], time: 70 },
  { in: i(M('cactus')), out: [o(M('green_dye'), 2), o(M('green_dye'), 1, 0.1)], time: 50 },
  { in: i(M('clay')), out: [o(M('clay_ball'), 4)], time: 50 },
  { in: i(M('calcite')), out: [o(M('bone_meal'), 1, 0.75)], time: 250 },
  { in: i(M('sugar_cane')), out: [o(M('sugar'), 2), o(M('sugar'), 1, 0.1)], time: 50 },
  { in: i(M('cocoa_beans')), out: [o(M('brown_dye'), 2), o(M('brown_dye'), 1, 0.1)], time: 70 },
  { in: i(M('ink_sac')), out: [o(M('black_dye'), 2), o(M('gray_dye'), 1, 0.1)], time: 100 },
  { in: i(M('lapis_lazuli')), out: [o(M('blue_dye'), 2), o(M('blue_dye'), 1, 0.1)], time: 100 },
  { in: i(M('beetroot')), out: [o(M('red_dye'), 2), o(M('beetroot_seeds'), 1, 0.1)], time: 70 },
  { in: i(M('dandelion')), out: [o(M('yellow_dye'), 2), o(M('yellow_dye'), 1, 0.05)], time: 50 },
  { in: i(M('poppy')), out: [o(M('red_dye'), 2), o(M('green_dye'), 1, 0.05)], time: 50 },
  { in: i(M('cornflower')), out: [o(M('blue_dye'), 2)], time: 50 },
  { in: i(M('oxeye_daisy')), out: [o(M('light_gray_dye'), 2), o(M('white_dye'), 1, 0.2)], time: 50 },
  { in: i(M('azure_bluet')), out: [o(M('light_gray_dye'), 2), o(M('white_dye'), 2, 0.1)], time: 50 },
  { in: i(M('allium')), out: [o(M('magenta_dye'), 2), o(M('purple_dye'), 2, 0.1)], time: 50 },
  { in: i(M('blue_orchid')), out: [o(M('light_blue_dye'), 2), o(M('light_gray_dye'), 1, 0.05)], time: 50 },
  { in: i(M('red_tulip')), out: [o(M('red_dye'), 2), o(M('lime_dye'), 1, 0.1)], time: 50 },
  { in: i(M('orange_tulip')), out: [o(M('orange_dye'), 2), o(M('lime_dye'), 1, 0.1)], time: 50 },
  { in: i(M('white_tulip')), out: [o(M('white_dye'), 2), o(M('lime_dye'), 1, 0.1)], time: 50 },
  { in: i(M('pink_tulip')), out: [o(M('pink_dye'), 2), o(M('lime_dye'), 1, 0.1)], time: 50 },
  { in: i(M('lily_of_the_valley')), out: [o(M('white_dye'), 2), o(M('lime_dye'), 1, 0.1)], time: 50 },
  { in: i(M('sunflower')), out: [o(M('yellow_dye'), 3), o(M('orange_dye'), 1, 0.25)], time: 100 },
  { in: i(M('lilac')), out: [o(M('magenta_dye'), 3), o(M('purple_dye'), 1, 0.25)], time: 100 },
  { in: i(M('rose_bush')), out: [o(M('red_dye'), 3), o(M('green_dye'), 2, 0.05)], time: 50 },
  { in: i(M('peony')), out: [o(M('pink_dye'), 3), o(M('magenta_dye'), 1, 0.25)], time: 100 },
  { in: i(M('wither_rose')), out: [o(M('black_dye'), 2), o(M('black_dye'), 1, 0.1)], time: 50 },
  { in: i(M('short_grass')), out: [o(M('wheat_seeds'), 1, 0.25)], time: 50 },
  { in: i(M('tall_grass')), out: [o(M('wheat_seeds'), 1, 0.5)], time: 100 },
  { in: { tag: 'craftoria:wool' }, out: [o(M('string'))], time: 100 },
];

export const CRUSHING: ItemRecipe[] = [
  { in: i(M('raw_iron')), out: [o(C('crushed_raw_iron')), o(C('experience_nugget'), 1, 0.75)], time: 400 },
  { in: i(M('raw_gold')), out: [o(C('crushed_raw_gold')), o(C('experience_nugget'), 2, 0.75)], time: 400 },
  { in: i(M('raw_copper')), out: [o(C('crushed_raw_copper')), o(C('experience_nugget'), 1, 0.75)], time: 400 },
  { in: i(C('raw_zinc')), out: [o(C('crushed_raw_zinc')), o(C('experience_nugget'), 1, 0.75)], time: 400 },
  { in: i(M('iron_ore')), out: [o(C('crushed_raw_iron')), o(C('crushed_raw_iron'), 1, 0.75), o(C('experience_nugget'), 1, 0.75), o(M('cobblestone'), 1, 0.125)], time: 250 },
  { in: i(M('deepslate_iron_ore')), out: [o(C('crushed_raw_iron'), 2), o(C('crushed_raw_iron'), 1, 0.25), o(C('experience_nugget'), 1, 0.75), o(M('cobbled_deepslate'), 1, 0.125)], time: 350 },
  { in: i(M('gold_ore')), out: [o(C('crushed_raw_gold')), o(C('crushed_raw_gold'), 1, 0.75), o(C('experience_nugget'), 2, 0.75), o(M('cobblestone'), 1, 0.125)], time: 250 },
  { in: i(M('deepslate_gold_ore')), out: [o(C('crushed_raw_gold'), 2), o(C('crushed_raw_gold'), 1, 0.25), o(C('experience_nugget'), 2, 0.75), o(M('cobbled_deepslate'), 1, 0.125)], time: 350 },
  { in: i(M('copper_ore')), out: [o(C('crushed_raw_copper'), 5), o(C('crushed_raw_copper'), 1, 0.25), o(C('experience_nugget'), 1, 0.75), o(M('cobblestone'), 1, 0.125)], time: 250 },
  { in: i(M('deepslate_copper_ore')), out: [o(C('crushed_raw_copper'), 7), o(C('crushed_raw_copper'), 1, 0.25), o(C('experience_nugget'), 1, 0.75), o(M('cobbled_deepslate'), 1, 0.125)], time: 350 },
  { in: i(C('zinc_ore')), out: [o(C('crushed_raw_zinc')), o(C('crushed_raw_zinc'), 1, 0.75), o(C('experience_nugget'), 1, 0.75), o(M('cobblestone'), 1, 0.125)], time: 250 },
  { in: i(C('deepslate_zinc_ore')), out: [o(C('crushed_raw_zinc'), 2), o(C('crushed_raw_zinc'), 1, 0.25), o(C('experience_nugget'), 1, 0.75), o(M('cobbled_deepslate'), 1, 0.125)], time: 350 },
  { in: i(M('coal_ore')), out: [o(M('coal')), o(M('coal'), 1, 0.75), o(C('experience_nugget'), 1, 0.75), o(M('cobblestone'), 1, 0.125)], time: 150 },
  { in: i(M('gravel')), out: [o(M('sand')), o(M('flint'), 1, 0.1), o(M('clay_ball'), 1, 0.05)], time: 250 },
  { in: i(M('cobblestone')), out: [o(M('gravel'))], time: 250 },
  { in: i(M('netherrack')), out: [o(C('cinder_flour')), o(C('cinder_flour'), 1, 0.5)], time: 250 },
  { in: i(M('obsidian')), out: [o(C('powdered_obsidian')), o(M('obsidian'), 1, 0.75)], time: 500 },
  { in: i(M('blaze_rod')), out: [o(M('blaze_powder'), 3), o(M('blaze_powder'), 3, 0.25)], time: 100 },
  { in: i(M('diorite')), out: [o(M('quartz'), 1, 0.25)], time: 350 },
  { in: i(M('tuff')), out: [o(M('flint'), 1, 0.25), o(M('gold_nugget'), 1, 0.1), o(C('copper_nugget'), 1, 0.1), o(C('zinc_nugget'), 1, 0.1), o(M('iron_nugget'), 1, 0.1)], time: 350 },
  { in: i(M('amethyst_block')), out: [o(M('amethyst_shard'), 3), o(M('amethyst_shard'), 1, 0.5)], time: 150 },
  { in: i(M('glowstone')), out: [o(M('glowstone_dust'), 3), o(M('glowstone_dust'), 1, 0.5)], time: 150 },
  { in: i(M('prismarine_crystals')), out: [o(M('quartz')), o(M('quartz'), 2, 0.5), o(M('glowstone_dust'), 2, 0.1)], time: 150 },
  { in: { tag: 'craftoria:wool' }, out: [o(M('string'), 2), o(M('string'), 1, 0.5)], time: 100 },
];

const CONCRETE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

export const MIXING: BasinRecipe[] = [
  { items: [i(M('andesite')), i(M('iron_nugget'))], out: [o(C('andesite_alloy'))], time: 100 },
  { items: [i(M('andesite')), i(C('zinc_nugget'))], out: [o(C('andesite_alloy'))], time: 100 },
  { items: [i(M('copper_ingot')), i(C('zinc_ingot'))], out: [o(C('brass_ingot'), 2)], heat: true, time: 140 },
  { items: [i(C('wheat_flour'))], fluids: [{ f: 'water', mb: 250 }], out: [o(C('dough'))], time: 80 },
  { items: [i(M('dirt'))], fluids: [{ f: 'water', mb: 250 }], out: [o(M('mud'))], time: 60 },
  { items: [i(M('cobblestone'))], out: [], outFluid: { f: 'lava', mb: 50 }, heat: true, time: 200 },
  { items: [i(M('honeycomb'), 2)], fluids: [{ f: 'water', mb: 250 }], out: [], outFluid: { f: 'honey', mb: 250 }, heat: true, time: 120 },
  ...CONCRETE_COLORS.map((c) => ({ items: [i(M(`${c}_concrete_powder`))], fluids: [{ f: 'water' as FluidId, mb: 250 }], out: [o(M(`${c}_concrete`))], time: 40 })),
];

export const CUTTING: ItemRecipe[] = (() => {
  const r: ItemRecipe[] = [];
  for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']) {
    r.push({ in: i(M(`${w}_log`)), out: [o(M(`stripped_${w}_log`))], time: 50 });
    r.push({ in: i(M(`${w}_wood`)), out: [o(M(`stripped_${w}_wood`))], time: 50 });
    r.push({ in: i(M(`stripped_${w}_log`)), out: [o(M(`${w}_planks`), 6)], time: 50 });
    r.push({ in: i(M(`stripped_${w}_wood`)), out: [o(M(`${w}_planks`), 6)], time: 50 });
  }
  for (const w of ['crimson', 'warped']) {
    r.push({ in: i(M(`${w}_stem`)), out: [o(M(`stripped_${w}_stem`))], time: 50 });
    r.push({ in: i(M(`stripped_${w}_stem`)), out: [o(M(`${w}_planks`), 6)], time: 50 });
  }
  r.push({ in: i(C('andesite_alloy')), out: [o(C('shaft'), 6)], time: 200 });
  r.push({ in: i(M('bamboo_block')), out: [o(M('stripped_bamboo_block'))], time: 50 });
  r.push({ in: i(M('stripped_bamboo_block')), out: [o(M('bamboo_planks'), 2)], time: 50 });
  r.push({ in: i(M('stone')), out: [o(M('stone_bricks'))], time: 40 });
  r.push({ in: i(M('melon_block')), out: [o(M('melon_slice'), 9)], time: 30 });
  return r;
})();

export const DEPLOYING: DeployRecipe[] = [
  { target: { tag: 'craftoria:stripped_logs' }, held: i(C('andesite_alloy')), out: [o(C('andesite_casing'))] },
  { target: { tag: 'craftoria:stripped_logs' }, held: i(C('brass_ingot')), out: [o(C('brass_casing'))] },
  { target: { tag: 'craftoria:stripped_logs' }, held: i(M('copper_ingot')), out: [o(C('copper_casing'))] },
  { target: i(C('golden_sheet')), held: i(C('cogwheel')), out: [o(C('precision_mechanism'))] },
  { target: i(C('iron_sheet')), held: i(M('redstone_torch')), out: [o(C('electron_tube'))] },
];

export const FILLING: FillRecipe[] = [
  { target: i(M('glass_bottle')), fluid: { f: 'water', mb: 250 }, out: [o(M('potion'))] },
  { target: i(M('bucket')), fluid: { f: 'water', mb: 1000 }, out: [o(M('water_bucket'))] },
  { target: i(M('bucket')), fluid: { f: 'lava', mb: 1000 }, out: [o(M('lava_bucket'))] },
  { target: i(M('bucket')), fluid: { f: 'milk', mb: 1000 }, out: [o(M('milk_bucket'))] },
  { target: i(M('glass_bottle')), fluid: { f: 'honey', mb: 250 }, out: [o(M('honey_bottle'))] },
  { target: i(M('dirt')), fluid: { f: 'water', mb: 500 }, out: [o(M('grass_block'))] },
  ...CONCRETE_COLORS.map((c) => ({ target: i(M(`${c}_concrete_powder`)), fluid: { f: 'water' as FluidId, mb: 250 }, out: [o(M(`${c}_concrete`))] })),
];

/** Fan processing: washing (water), smelting (lava / fire / campfire), haunting not implemented. */
export const WASHING: ItemRecipe[] = [
  { in: i(C('crushed_raw_iron')), out: [o(M('iron_nugget'), 9), o(M('redstone'), 1, 0.75)], time: 150 },
  { in: i(C('crushed_raw_gold')), out: [o(M('gold_nugget'), 9), o(M('quartz'), 2, 0.5)], time: 150 },
  { in: i(C('crushed_raw_copper')), out: [o(C('copper_nugget'), 9), o(M('clay_ball'), 1, 0.5)], time: 150 },
  { in: i(C('crushed_raw_zinc')), out: [o(C('zinc_nugget'), 9), o(M('gunpowder'), 1, 0.25)], time: 150 },
  { in: i(M('gravel')), out: [o(M('flint'), 1, 0.25), o(M('iron_nugget'), 1, 0.125)], time: 150 },
  { in: i(M('sand')), out: [o(M('clay_ball'), 1, 0.25)], time: 150 },
  { in: i(M('red_sand')), out: [o(M('gold_nugget'), 3, 0.12), o(M('dead_bush'), 1, 0.05)], time: 150 },
  { in: i(M('soul_sand')), out: [o(M('quartz'), 4, 0.12), o(M('gold_nugget'), 1, 0.02)], time: 150 },
  ...CONCRETE_COLORS.map((c) => ({ in: i(M(`${c}_concrete_powder`)), out: [o(M(`${c}_concrete`))], time: 150 })),
];

export const SMELTING: ItemRecipe[] = [
  { in: i(M('raw_iron')), out: [o(M('iron_ingot'))], time: 150 },
  { in: i(M('raw_gold')), out: [o(M('gold_ingot'))], time: 150 },
  { in: i(M('raw_copper')), out: [o(M('copper_ingot'))], time: 150 },
  { in: i(C('raw_zinc')), out: [o(C('zinc_ingot'))], time: 150 },
  { in: i(C('crushed_raw_iron')), out: [o(M('iron_ingot'))], time: 150 },
  { in: i(C('crushed_raw_gold')), out: [o(M('gold_ingot'))], time: 150 },
  { in: i(C('crushed_raw_copper')), out: [o(M('copper_ingot'))], time: 150 },
  { in: i(C('crushed_raw_zinc')), out: [o(C('zinc_ingot'))], time: 150 },
  { in: i(M('cobblestone')), out: [o(M('stone'))], time: 150 },
  { in: i(M('sand')), out: [o(M('glass'))], time: 150 },
  { in: i(M('clay_ball')), out: [o(M('brick'))], time: 150 },
  { in: i(C('dough')), out: [o(M('bread'))], time: 150 },
  { in: i(M('beef')), out: [o(M('cooked_beef'))], time: 150 },
  { in: i(M('porkchop')), out: [o(M('cooked_porkchop'))], time: 150 },
  { in: i(M('chicken')), out: [o(M('cooked_chicken'))], time: 150 },
  { in: i(M('mutton')), out: [o(M('cooked_mutton'))], time: 150 },
  { in: i(M('potato')), out: [o(M('baked_potato'))], time: 150 },
  { in: i(M('kelp')), out: [o(M('dried_kelp'))], time: 150 },
  { in: { tag: 'craftoria:logs' }, out: [o(M('charcoal'))], time: 150 },
];

// ---------------------------------------------------------------------------------------------

export function matches(ing: Ingredient, s: SItem | string): boolean {
  const id = typeof s === 'string' ? s : s.id;
  if (ing.id) return ing.id === id;
  if (ing.tag) return hasTag(id, ing.tag);
  return false;
}

export function findItemRecipe(list: ItemRecipe[], s: SItem): ItemRecipe | undefined {
  for (const r of list) if (matches(r.in, s) && s.n >= (r.in.n ?? 1)) return r;
  return undefined;
}

export function anyItemRecipe(list: ItemRecipe[], id: string): boolean {
  return list.some((r) => matches(r.in, id));
}

/** Roll outputs with chances (rng injectable for tests). */
export function rollOutputs(out: Output[], rng: () => number = Math.random): SItem[] {
  const res: SItem[] = [];
  for (const x of out) {
    if (x.chance !== undefined && rng() >= x.chance) continue;
    const ex = res.find((r) => r.id === x.id);
    if (ex) ex.n += x.n;
    else res.push({ id: x.id, n: x.n });
  }
  return res;
}

export interface BasinState {
  items: SItem[];
  fluids: { f: FluidId; mb: number }[];
}

/** First basin recipe satisfiable by the current contents. */
export function findBasinRecipe(list: BasinRecipe[], st: BasinState, heated: boolean): BasinRecipe | undefined {
  for (const r of list) {
    if (r.heat && !heated) continue;
    let ok = true;
    // items: each ingredient needs its count (ingredients are distinct items in our tables)
    for (const ing of r.items) {
      const have = st.items.filter((s) => matches(ing, s)).reduce((a, s) => a + s.n, 0);
      if (have < (ing.n ?? 1)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const fl of r.fluids ?? []) {
      const have = st.fluids.find((x) => x.f === fl.f)?.mb ?? 0;
      if (have < fl.mb) {
        ok = false;
        break;
      }
    }
    if (ok) return r;
  }
  return undefined;
}

/** Consume a basin recipe's inputs from the state (mutates). */
export function consumeBasin(r: BasinRecipe, st: BasinState): void {
  for (const ing of r.items) {
    let need = ing.n ?? 1;
    for (let k = 0; k < st.items.length && need > 0; k++) {
      const s = st.items[k];
      if (!matches(ing, s)) continue;
      const t = Math.min(need, s.n);
      s.n -= t;
      need -= t;
      if (s.n <= 0) {
        st.items.splice(k, 1);
        k--;
      }
    }
  }
  for (const fl of r.fluids ?? []) {
    const f = st.fluids.find((x) => x.f === fl.f);
    if (f) f.mb -= fl.mb;
  }
  st.fluids = st.fluids.filter((f) => f.mb > 0);
}

export function findDeploy(target: SItem, held: SItem | undefined): DeployRecipe | undefined {
  if (!held) return undefined;
  return DEPLOYING.find((r) => matches(r.target, target) && matches(r.held, held));
}

export function findFill(target: SItem, fluid: FluidId, mb: number): FillRecipe | undefined {
  return FILLING.find((r) => matches(r.target, target) && r.fluid.f === fluid && mb >= r.fluid.mb);
}
