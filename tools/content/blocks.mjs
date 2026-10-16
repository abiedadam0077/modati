// Block definitions -> BP/blocks/*.json + RP textures/geometry.
// Every block uses its own procedurally baked geometry + texture (see tools/models/blocks.mjs).

const box = (x0, y0, z0, x1, y1, z1) => ({ origin: [x0, y0, z0], size: [x1 - x0, y1 - y0, z1 - z0] });
const FULL = box(-8, 0, -8, 8, 16, 8);

/** orientation modes: see header of tools/models/blocks.mjs */
export const BLOCKS = [
  // ---------------- kinetic transmission ----------------
  { id: 'shaft', name: 'Shaft', model: 'shaft', orient: 'axis3', rotor: true, kinetic: true, hardness: 0.8, tool: 'pickaxe', material: 'metal',
    collision: box(-3, 0, -3, 3, 16, 3), selection: box(-3, 0, -3, 3, 16, 3), waterlog: true, light: 0 },
  { id: 'cogwheel', name: 'Cogwheel', model: 'cogwheel', orient: 'axis3', rotor: true, kinetic: true, hardness: 1.0, tool: 'axe', material: 'wood',
    collision: [box(-8, 5, -8, 8, 11, 8), box(-2, 0, -2, 2, 16, 2)], selection: box(-8, 4, -8, 8, 12, 8), waterlog: true, light: 0 },
  { id: 'large_cogwheel', name: 'Large Cogwheel', model: 'large_cogwheel', orient: 'axis3', rotor: true, kinetic: true, hardness: 1.2, tool: 'axe', material: 'wood',
    collision: [box(-8, 5, -8, 8, 11, 8), box(-2, 0, -2, 2, 16, 2)], selection: box(-8, 4, -8, 8, 12, 8), waterlog: true, light: 0 },
  { id: 'gearbox', name: 'Gearbox', model: 'gearbox', orient: 'axis3', rotor: true, kinetic: true, hardness: 2.0, tool: 'axe', material: 'wood', collision: FULL, selection: FULL },
  { id: 'clutch', name: 'Clutch', model: 'clutch', orient: 'axis3', rotor: true, kinetic: true, hardness: 2.0, tool: 'pickaxe', material: 'metal', redstone: true,
    states: { 'craftoria:powered': [false, true] }, boneVis: { lamp: "q.block_state('craftoria:powered')" },
    collision: box(-6, 0, -6, 6, 16, 6), selection: box(-6, 0, -6, 6, 16, 6), light: 0 },
  { id: 'gearshift', name: 'Gearshift', model: 'gearshift', orient: 'axis3', rotor: true, kinetic: true, hardness: 2.0, tool: 'pickaxe', material: 'metal', redstone: true,
    states: { 'craftoria:powered': [false, true] }, boneVis: { lamp: "q.block_state('craftoria:powered')" },
    collision: box(-6, 0, -6, 6, 16, 6), selection: box(-6, 0, -6, 6, 16, 6), light: 0 },
  { id: 'speedometer', name: 'Speedometer', model: 'speedometer', orient: 'axis3', rotor: true, kinetic: true, hardness: 1.5, tool: 'pickaxe', material: 'metal',
    collision: box(-6, 0, -6, 6, 16, 6), selection: box(-6, 0, -6, 6, 16, 6), light: 0 },
  { id: 'stressometer', name: 'Stressometer', model: 'stressometer', orient: 'axis3', rotor: true, kinetic: true, hardness: 1.5, tool: 'pickaxe', material: 'metal',
    collision: box(-6, 0, -6, 6, 16, 6), selection: box(-6, 0, -6, 6, 16, 6), light: 0 },

  // ---------------- generators ----------------
  { id: 'hand_crank', name: 'Hand Crank', model: 'hand_crank', orient: 'facing6', rotor: true, kinetic: true, hardness: 0.8, tool: 'axe', material: 'wood',
    collision: box(-4, 0, -4, 4, 4, 4), selection: box(-6, 0, -6, 6, 16, 6), light: 0, interact: true },
  { id: 'creative_motor', name: 'Creative Motor', model: 'creative_motor', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.0, tool: 'pickaxe', material: 'metal',
    collision: box(-7, 0, -7, 7, 14, 7), selection: box(-7, 0, -7, 7, 16, 7), light: 0, interact: true, creativeOnly: true },
  { id: 'water_wheel', name: 'Water Wheel', model: 'water_wheel', orient: 'haxis', authoredAxis: 'y', rotor: true, kinetic: true, hardness: 1.5, tool: 'axe', material: 'wood',
    collision: FULL, selection: FULL, light: 0 },
  { id: 'windmill_bearing', name: 'Windmill Bearing', model: 'windmill_bearing', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.0, tool: 'axe', material: 'wood', collision: FULL, selection: FULL, interact: true },

  // ---------------- processing ----------------
  { id: 'mechanical_press', name: 'Mechanical Press', model: 'mechanical_press', orient: 'haxis', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'metal',
    collision: box(-8, 4, -8, 8, 16, 8), selection: FULL, light: 0 },
  { id: 'mechanical_mixer', name: 'Mechanical Mixer', model: 'mechanical_mixer', orient: 'none', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'metal',
    collision: box(-8, 6, -8, 8, 16, 8), selection: FULL, light: 0 },
  { id: 'millstone', name: 'Millstone', model: 'millstone', orient: 'none', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'stone', collision: FULL, selection: FULL, interact: true },
  { id: 'crushing_wheel', name: 'Crushing Wheel', model: 'crushing_wheel', orient: 'axis3', rotor: true, kinetic: true, hardness: 3.0, tool: 'pickaxe', material: 'stone', collision: FULL, selection: FULL },
  { id: 'mechanical_drill', name: 'Mechanical Drill', model: 'mechanical_drill', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'metal',
    collision: box(-8, 0, -8, 8, 10, 8), selection: FULL, light: 0 },
  { id: 'mechanical_saw', name: 'Mechanical Saw', model: 'mechanical_saw', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:alt': [false, true] }, movingVis: "!q.block_state('craftoria:alt')", boneVis: { moving_alt: "!q.block_state('craftoria:rotor') && q.block_state('craftoria:alt')" }, collision: box(-8, 0, -8, 8, 10, 8), selection: FULL, light: 0 },
  { id: 'deployer', name: 'Deployer', model: 'deployer', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.5, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:alt': [false, true] }, movingVis: "!q.block_state('craftoria:alt')", boneVis: { hand: "!q.block_state('craftoria:rotor')", moving_alt: "!q.block_state('craftoria:rotor') && q.block_state('craftoria:alt')" }, collision: box(-8, 0, -8, 8, 13, 8), selection: FULL, light: 0, interact: true },
  { id: 'basin', name: 'Basin', model: 'basin', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'stone',
    states: { 'craftoria:fluid': [false, true] }, boneVis: { fluid: "q.block_state('craftoria:fluid')" },
    collision: [box(-8, 0, -8, 8, 2, 8), box(-8, 0, -8, 8, 14, -6), box(-8, 0, 6, 8, 14, 8), box(-8, 0, -6, -6, 14, 6), box(6, 0, -6, 8, 14, 6)],
    selection: box(-8, 0, -8, 8, 14, 8), light: 0, interact: true, machine: true },
  { id: 'depot', name: 'Depot', model: 'depot', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'metal', collision: box(-8, 0, -8, 8, 11, 8), selection: box(-8, 0, -8, 8, 11, 8), light: 0, interact: true, machine: true },
  { id: 'encased_fan', name: 'Encased Fan', model: 'encased_fan', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.0, tool: 'pickaxe', material: 'metal', collision: FULL, selection: FULL },

  // ---------------- logistics ----------------
  { id: 'belt', name: 'Mechanical Belt', model: 'belt', orient: 'belt', rotor: true, kinetic: true, hardness: 0.8, tool: 'axe', material: 'wool', noItem: true,
    states: { 'craftoria:part': ['middle', 'start', 'end'], 'craftoria:motion': { values: { min: 0, max: 8 } } },
    boneVis: { cap_start: "q.block_state('craftoria:part') == 'start'", cap_end: "q.block_state('craftoria:part') == 'end'" },
    movingVis: "q.block_state('craftoria:part') != 'middle'",
    collision: box(-8, 0, -8, 8, 13, 8), selection: box(-8, 3, -8, 8, 13, 8), light: 0, interact: true },
  { id: 'chute', name: 'Chute', model: 'chute', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'metal', collision: box(-6, 0, -6, 6, 16, 6), selection: box(-7, 0, -7, 7, 16, 7), light: 0, machine: true, interact: true },
  { id: 'andesite_funnel', name: 'Andesite Funnel', model: 'andesite_funnel', orient: 'facing6', hardness: 1.2, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:powered': [false, true] }, boneVis: { lamp: "!q.block_state('craftoria:powered')" },
    collision: box(-8, 0, -8, 8, 6, 8), selection: box(-8, 0, -8, 8, 6, 8), light: 0, machine: true, interact: true, redstone: true },
  { id: 'brass_funnel', name: 'Brass Funnel', model: 'brass_funnel', orient: 'facing6', hardness: 1.2, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:powered': [false, true] }, boneVis: { lamp: "!q.block_state('craftoria:powered')" },
    collision: box(-8, 0, -8, 8, 6, 8), selection: box(-8, 0, -8, 8, 6, 8), light: 0, machine: true, interact: true, redstone: true },
  { id: 'mechanical_arm', name: 'Mechanical Arm', model: 'mechanical_arm', orient: 'none', rotor: true, kinetic: true, hardness: 2.0, tool: 'pickaxe', material: 'metal',
    collision: box(-8, 0, -8, 8, 8, 8), selection: box(-8, 0, -8, 8, 12, 8), light: 0, interact: true },

  // ---------------- fluids ----------------
  { id: 'fluid_pipe', name: 'Fluid Pipe', model: 'fluid_pipe', orient: 'none', hardness: 1.0, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:c_up': [false, true], 'craftoria:c_down': [false, true], 'craftoria:c_north': [false, true], 'craftoria:c_south': [false, true], 'craftoria:c_west': [false, true], 'craftoria:c_east': [false, true] },
    boneVis: Object.fromEntries(['up', 'down', 'north', 'south', 'west', 'east'].map((d) => [`c_${d}`, `q.block_state('craftoria:c_${d}')`])),
    collision: box(-4, 4, -4, 4, 12, 4), selection: box(-4, 4, -4, 4, 12, 4), light: 0, machine: true, interact: true },
  { id: 'mechanical_pump', name: 'Mechanical Pump', model: 'mechanical_pump', orient: 'facing6', rotor: true, kinetic: true, hardness: 1.5, tool: 'pickaxe', material: 'metal',
    collision: box(-5, 0, -5, 5, 16, 5), selection: box(-6, 0, -6, 6, 16, 6), light: 0 },
  { id: 'fluid_tank', name: 'Fluid Tank', model: 'fluid_tank', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'glass', render: 'alpha_test',
    states: { 'craftoria:level': { values: { min: 0, max: 4 } } },
    boneVis: { level1: "q.block_state('craftoria:level') >= 1", level2: "q.block_state('craftoria:level') >= 2", level3: "q.block_state('craftoria:level') >= 3", level4: "q.block_state('craftoria:level') >= 4" },
    collision: FULL, selection: FULL, light: 0, machine: true, interact: true },
  { id: 'spout', name: 'Spout', model: 'spout', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'metal', collision: box(-6, 1, -6, 6, 16, 6), selection: box(-7, 1, -7, 7, 16, 7), light: 0, machine: true, interact: true },

  // ---------------- contraptions ----------------
  { id: 'mechanical_bearing', name: 'Mechanical Bearing', model: 'mechanical_bearing', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.0, tool: 'axe', material: 'wood', collision: FULL, selection: FULL, interact: true },
  { id: 'rope_pulley', name: 'Rope Pulley', model: 'rope_pulley', orient: 'haxis', rotor: true, kinetic: true, hardness: 2.0, tool: 'axe', material: 'wood', collision: FULL, selection: FULL, interact: true },
  { id: 'mechanical_piston', name: 'Mechanical Piston', model: 'mechanical_piston', orient: 'facing6', rotor: true, kinetic: true, hardness: 2.0, tool: 'axe', material: 'wood',
    states: { 'craftoria:alt': [false, true] }, movingVis: "!q.block_state('craftoria:alt')", boneVis: { moving_alt: "!q.block_state('craftoria:rotor') && q.block_state('craftoria:alt')" }, collision: FULL, selection: FULL, interact: true },
  { id: 'piston_pole', name: 'Piston Extension Pole', model: 'piston_pole', orient: 'axis3', hardness: 0.8, tool: 'axe', material: 'wood', collision: box(-2, 0, -2, 2, 16, 2), selection: box(-3, 0, -3, 3, 16, 3), light: 0 },
  { id: 'sail', name: 'Sail', model: 'sail', orient: 'facing6', hardness: 0.5, tool: 'axe', material: 'wool', collision: box(-8, 7, -8, 8, 9, 8), selection: box(-8, 6, -8, 8, 10, 8), light: 0, flammable: true },
  { id: 'sail_frame', name: 'Sail Frame', model: 'sail_frame', orient: 'facing6', hardness: 0.5, tool: 'axe', material: 'wood', collision: box(-8, 7, -8, 8, 9, 8), selection: box(-8, 6, -8, 8, 10, 8), light: 0, flammable: true },
  { id: 'elevator_contact', name: 'Elevator Contact', model: 'elevator_contact', orient: 'none', hardness: 1.5, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:powered': [false, true] }, boneVis: { lamp: "q.block_state('craftoria:powered')" }, collision: FULL, selection: FULL, interact: true, machine: true, redstoneSource: true },

  // ---------------- trains ----------------
  { id: 'track', name: 'Train Track', model: 'track', orient: 'track', hardness: 0.7, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:shape': ['ns', 'ew', 'ne', 'es', 'sw', 'wn'] },
    boneVis: { straight: "q.block_state('craftoria:shape') == 'ns' || q.block_state('craftoria:shape') == 'ew'", curve: "q.block_state('craftoria:shape') != 'ns' && q.block_state('craftoria:shape') != 'ew'" },
    collision: box(-8, 0, -8, 8, 3, 8), selection: box(-8, 0, -8, 8, 3, 8), light: 0, machine: true },
  { id: 'train_station', name: 'Train Station', model: 'train_station', orient: 'facing4', hardness: 2.0, tool: 'pickaxe', material: 'metal', collision: FULL, selection: FULL, interact: true, machine: true },
  { id: 'train_signal', name: 'Train Signal', model: 'train_signal', orient: 'facing4', hardness: 1.5, tool: 'pickaxe', material: 'metal',
    states: { 'craftoria:red': [false, true] }, boneVis: { lamp_red: "q.block_state('craftoria:red')", lamp_green: "!q.block_state('craftoria:red')" },
    collision: box(-3, 0, -3, 3, 16, 3), selection: box(-3, 0, -3, 3, 16, 3), light: 0, machine: true, redstone: true },
  { id: 'train_controls', name: 'Train Controls', model: 'train_controls', orient: 'facing4', hardness: 1.5, tool: 'pickaxe', material: 'metal', collision: box(-8, 0, -8, 8, 10, 8), selection: FULL, light: 0, interact: true },
  { id: 'seat', name: 'Seat', model: 'seat', orient: 'none', hardness: 0.8, tool: 'axe', material: 'wool', collision: box(-8, 0, -8, 8, 8, 8), selection: box(-8, 0, -8, 8, 8, 8), light: 0, interact: true },
];

/** Plain full blocks (materials / casings / ores) using a single cube texture. */
export const SIMPLE_BLOCKS = [
  { id: 'andesite_casing', name: 'Andesite Casing', texture: 'casing_andesite', hardness: 2.0, tool: 'axe', material: 'wood' },
  { id: 'brass_casing', name: 'Brass Casing', texture: 'casing_brass', hardness: 2.0, tool: 'axe', material: 'wood' },
  { id: 'copper_casing', name: 'Copper Casing', texture: 'casing_copper', hardness: 2.0, tool: 'axe', material: 'wood' },
  { id: 'zinc_ore', name: 'Zinc Ore', texture: 'zinc_ore', hardness: 3.0, tool: 'pickaxe', material: 'stone', loot: 'zinc_ore', requiresPick: true },
  { id: 'deepslate_zinc_ore', name: 'Deepslate Zinc Ore', texture: 'deepslate_zinc_ore', hardness: 4.5, tool: 'pickaxe', material: 'stone', loot: 'zinc_ore', requiresPick: true },
  { id: 'zinc_block', name: 'Block of Zinc', texture: 'zinc_block', hardness: 5.0, tool: 'pickaxe', material: 'metal' },
  { id: 'brass_block', name: 'Block of Brass', texture: 'brass_block', hardness: 5.0, tool: 'pickaxe', material: 'metal' },
];
