// Sound definitions for the synthesized CRAFTORIA sounds (assets/sounds/*.ogg).
export const SOUND_FILES = ['crank', 'press', 'press_light', 'mixer', 'millstone', 'crusher', 'saw', 'drill', 'deployer', 'arm', 'fan', 'pump', 'hum',
  'contraption_start', 'contraption_stop', 'train_horn', 'train_move', 'station_chime', 'wrench', 'fault', 'item_pop', 'glue', 'water_wheel'];

const MAX = { hum: 10, fan: 14, train_horn: 64, train_move: 32, station_chime: 32, fault: 24 };

export function soundDefinitions() {
  const defs = {};
  for (const f of SOUND_FILES) {
    defs[`craftoria.${f}`] = {
      category: f.startsWith('train') || f === 'station_chime' ? 'neutral' : 'block',
      min_distance: 1,
      max_distance: MAX[f] ?? 18,
      sounds: [{ name: `sounds/craftoria/${f}`, volume: 1.0, pitch: 1.0, load_on_low_memory: true }],
    };
  }
  return { format_version: '1.20.20', sound_definitions: defs };
}
