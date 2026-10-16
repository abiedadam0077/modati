// Item definitions -> BP/items/*.json + RP item textures.
import * as I from '../lib/icons.mjs';

export const ITEMS = [
  // materials
  { id: 'andesite_alloy', name: 'Andesite Alloy', icon: () => I.ingot('andesite') },
  { id: 'raw_zinc', name: 'Raw Zinc', icon: () => I.rawOre('zinc') },
  { id: 'zinc_ingot', name: 'Zinc Ingot', icon: () => I.ingot('zinc') },
  { id: 'zinc_nugget', name: 'Zinc Nugget', icon: () => I.nugget('zinc') },
  { id: 'brass_ingot', name: 'Brass Ingot', icon: () => I.ingot('brass') },
  { id: 'brass_nugget', name: 'Brass Nugget', icon: () => I.nugget('brass') },
  { id: 'copper_nugget', name: 'Copper Nugget', icon: () => I.nugget('copper') },
  { id: 'iron_sheet', name: 'Iron Sheet', icon: () => I.sheet('iron') },
  { id: 'copper_sheet', name: 'Copper Sheet', icon: () => I.sheet('copper') },
  { id: 'brass_sheet', name: 'Brass Sheet', icon: () => I.sheet('brass') },
  { id: 'golden_sheet', name: 'Golden Sheet', icon: () => I.sheet('gold') },
  { id: 'crushed_raw_iron', name: 'Crushed Iron Ore', icon: () => I.crushed('iron') },
  { id: 'crushed_raw_gold', name: 'Crushed Gold Ore', icon: () => I.crushed('gold') },
  { id: 'crushed_raw_copper', name: 'Crushed Copper Ore', icon: () => I.crushed('copper') },
  { id: 'crushed_raw_zinc', name: 'Crushed Zinc Ore', icon: () => I.crushed('zinc') },
  { id: 'wheat_flour', name: 'Wheat Flour', icon: () => I.dust('#f2ead5', '#d8ccb0') },
  { id: 'dough', name: 'Dough', icon: () => I.dough() },
  { id: 'cinder_flour', name: 'Cinder Flour', icon: () => I.dust('#8a3a32', '#5e2622') },
  { id: 'powdered_obsidian', name: 'Powdered Obsidian', icon: () => I.dust('#3a2a52', '#1e1430') },
  { id: 'experience_nugget', name: 'Nugget of Experience', icon: () => I.xpNugget(), use: true },
  { id: 'precision_mechanism', name: 'Precision Mechanism', icon: () => I.mechanism() },
  { id: 'electron_tube', name: 'Electron Tube', icon: () => I.electronTube() },
  { id: 'propeller', name: 'Propeller', icon: () => I.propellerIcon() },
  { id: 'whisk', name: 'Whisk', icon: () => I.whisk() },
  { id: 'brass_hand', name: 'Brass Hand', icon: () => I.brassHand() },
  // tools
  { id: 'belt_connector', name: 'Mechanical Belt', icon: () => I.beltConnector(), use: true, stack: 64 },
  { id: 'super_glue', name: 'Super Glue', icon: () => I.superGlue(), use: true, stack: 1, durability: 200 },
  { id: 'wrench', name: 'Wrench', icon: () => I.wrench(), use: true, stack: 1, hand: true },
  { id: 'engineers_goggles', name: "Engineer's Goggles", icon: () => I.goggles(), stack: 1, wearable: 'slot.armor.head' },
  { id: 'filter', name: 'Filter', icon: () => I.filterIcon(), use: true, stack: 1 },
  { id: 'engineers_manual', name: "Engineer's Manual", icon: () => I.manual(), use: true, stack: 1 },
];
