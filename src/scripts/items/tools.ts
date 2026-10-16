// Player tools: Wrench, Engineer's Goggles (HUD), Engineer's Manual (guide + settings),
// Super Glue, Belt Connector, Filter, Nugget of Experience, in-world casing application.
import { Block, EquipmentSlot, ItemStack, Player, system, world } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { Axis, DIRS, Dir, V3, dimKey, HORIZONTAL } from '../util/vec';
import { actionbar, blockAt, getStates, msg, players, runCmd, setStates, logError } from '../core/env';
import { settings, saveSettings } from '../core/settings';
import { ID, KINETIC_DEFS, S_ALT, S_AXIS, S_FACING } from '../kinetics/defs';
import { markTopologyDirty, netOf, speedOf } from '../kinetics/network';
import { MOTOR_STEPS, motorSpeed, setMotorSpeed, turnCrank } from '../kinetics/generators';
import { removeRotor } from '../visuals/rotors';
import { useBeltConnector } from '../logistics/belt';
import { useGlue } from '../contraptions/contraption';
import { openFilterUI } from '../logistics/chute_funnel';
import { consumeHeld, heldItem } from '../logistics/transport';
import { sound } from '../machines/common';
import { hasTag } from '../util/items';
import { registerMachine } from '../machines/registry';
import { MIXER_MIN_SPEED } from '../machines/press_mixer';
import { tankInfo } from '../fluids/fluids';
import { basinGet, depotGet } from '../machines/depot_basin';

// ------------------------------------------------------------------ wrench
const AXIS_CYCLE: Record<string, Axis> = { y: 'x', x: 'z', z: 'y' };
const FACE6: Dir[] = ['up', 'down', 'north', 'south', 'west', 'east'];
const FACE4: Dir[] = ['north', 'east', 'south', 'west'];

function wrenchRotate(b: Block, p: Player): void {
  const st = getStates(b);
  const id = b.typeId;
  if (id === ID('belt') || id === ID('track')) {
    msg(p, '§7This block cannot be rotated.');
    return;
  }
  const changes: Record<string, string | boolean> = {};
  if (S_FACING in st) {
    const f = st[S_FACING] as Dir;
    const list = FACE6.includes(f) && 'craftoria:axis' in st ? FACE6 : (HORIZONTAL as Dir[]).includes(f) && !['up', 'down'].some((x) => x === f) && isFacing4(id) ? FACE4 : FACE6;
    const sideAxisBlock = S_ALT in st;
    if (sideAxisBlock && !st[S_ALT]) changes[S_ALT] = true;
    else {
      if (sideAxisBlock) changes[S_ALT] = false;
      changes[S_FACING] = list[(list.indexOf(f) + 1) % list.length];
    }
  } else if (S_AXIS in st) {
    const a = st[S_AXIS] as Axis;
    const horizontalOnly = id === ID('mechanical_press') || id === ID('water_wheel') || id === ID('rope_pulley');
    changes[S_AXIS] = horizontalOnly ? (a === 'x' ? 'z' : 'x') : AXIS_CYCLE[a];
  } else {
    msg(p, '§7Nothing to rotate.');
    return;
  }
  setStates(b, changes);
  if (KINETIC_DEFS[id]) {
    removeRotor(dimKey(b.dimension.id, b.location));
    markTopologyDirty(b.dimension.id, b.location);
  }
  sound(b.dimension, 'craftoria.wrench', b.center(), 0.6, 1.0);
}
function isFacing4(id: string): boolean {
  return id === ID('train_station') || id === ID('train_signal') || id === ID('train_controls');
}

function wrenchPickup(b: Block, p: Player): void {
  const loc = { ...b.location };
  runCmd(b.dimension, `setblock ${loc.x} ${loc.y} ${loc.z} air destroy`);
  // move the drop to the player
  system.runTimeout(() => {
    try {
      for (const e of p.dimension.getEntities({ type: 'minecraft:item', location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 1.5 })) e.teleport(p.location);
    } catch {
      /* ignore */
    }
  }, 1);
  sound(b.dimension, 'craftoria.wrench', { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, 0.6, 0.7);
}

// ------------------------------------------------------------------ central interaction hook
const CASING_FROM: Record<string, string> = {
  [ID('andesite_alloy')]: ID('andesite_casing'),
  [ID('brass_ingot')]: ID('brass_casing'),
  'minecraft:copper_ingot': ID('copper_casing'),
};

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || !ev.isFirstEvent) return;
  const p = ev.player;
  const b = ev.block;
  const tid = item.typeId;
  if (tid === ID('wrench') && b.typeId.startsWith('craftoria:')) {
    ev.cancel = true;
    const sneaking = p.isSneaking;
    system.run(() => {
      const bb = blockAt(b.dimension, b.location);
      if (!bb) return;
      if (sneaking) wrenchPickup(bb, p);
      else wrenchRotate(bb, p);
    });
    return;
  }
  if (tid === ID('belt_connector')) {
    ev.cancel = true;
    system.run(() => {
      const bb = blockAt(b.dimension, b.location);
      if (bb) useBeltConnector(p, bb);
    });
    return;
  }
  if (tid === ID('super_glue')) {
    ev.cancel = true;
    system.run(() => {
      const bb = blockAt(b.dimension, b.location);
      if (bb) useGlue(p, bb);
    });
    return;
  }
  const casing = CASING_FROM[tid];
  if (casing && hasTag(b.typeId, 'craftoria:stripped_logs')) {
    ev.cancel = true;
    system.run(() => {
      try {
        b.dimension.setBlockType(b.location, casing);
        consumeHeld(p, 1);
        sound(b.dimension, 'craftoria.press_light', b.center(), 0.6, 1.3);
      } catch (e) {
        logError('casing', e);
      }
    });
  }
});

// generators with interaction
registerMachine(ID('hand_crank'), {
  onInteract(b, p) {
    turnCrank(b, p);
    return true;
  },
});
registerMachine(ID('creative_motor'), {
  onInteract(b, p) {
    const key = dimKey(b.dimension.id, b.location);
    const cur = motorSpeed(key);
    const form = new ModalFormData().title('Creative Motor').slider('Speed (RPM)', 0, MOTOR_STEPS.length - 1, { valueStep: 1, defaultValue: Math.max(0, MOTOR_STEPS.indexOf(cur)) });
    form.show(p).then((r) => {
      if (r.canceled || !r.formValues) return;
      const idx = Number(r.formValues[0]);
      const v = MOTOR_STEPS[Math.max(0, Math.min(MOTOR_STEPS.length - 1, idx))];
      setMotorSpeed(b.dimension.id, b.location, v);
      msg(p, `§aCreative Motor: ${v} RPM`);
    }).catch(() => undefined);
    return true;
  },
});

// ------------------------------------------------------------------ goggles HUD
function wearsGoggles(p: Player): boolean {
  try {
    const eq = p.getComponent('minecraft:equippable');
    const head = eq?.getEquipment(EquipmentSlot.Head);
    if (head?.typeId === ID('engineers_goggles')) return true;
    const hand = eq?.getEquipment(EquipmentSlot.Mainhand);
    return hand?.typeId === ID('engineers_goggles') || hand?.typeId === ID('wrench');
  } catch {
    return false;
  }
}

const STATUS_TEXT: Record<string, string> = {
  running: '§aRunning',
  stopped: '§7No rotation source',
  overstressed: '§cOVERSTRESSED — add capacity or reduce speed',
  conflict: '§cJAMMED — sources/gears turn against each other',
  overspeed: '§cOVERSPEED — above 256 RPM',
  too_large: '§cNetwork too large',
};

export function goggleText(b: Block): string | undefined {
  const id = b.typeId;
  if (!id.startsWith('craftoria:')) return undefined;
  const dim = b.dimension.id;
  const parts: string[] = [];
  const name = id.replace('craftoria:', '').replace(/_/g, ' ');
  parts.push(`§e${name}`);
  if (KINETIC_DEFS[id]) {
    const net = netOf(dim, b.location) ?? netOf(dim, b.location, 'a');
    const sp = id === ID('clutch') || id === ID('gearshift') ? speedOf(dim, b.location, 'a') : speedOf(dim, b.location);
    parts.push(`§fSpeed: §b${Math.abs(sp).toFixed(sp % 1 ? 1 : 0)} RPM${sp < 0 ? ' §7(ccw)' : sp > 0 ? ' §7(cw)' : ''}`);
    if (net) {
      parts.push(`§fStress: ${net.impact > net.capacity ? '§c' : '§a'}${Math.round(net.impact)}§7/§f${Math.round(net.capacity)} SU`);
      parts.push(STATUS_TEXT[net.status] ?? net.status);
    }
    if (id === ID('mechanical_mixer') && Math.abs(sp) > 0 && Math.abs(sp) < MIXER_MIN_SPEED) parts.push(`§cNeeds at least ${MIXER_MIN_SPEED} RPM`);
  }
  const key = dimKey(dim, b.location);
  if (id === ID('fluid_tank') || id === ID('spout')) {
    const t = tankInfo(id, key);
    parts.push(t?.f ? `§b${t.f}: ${t.mb} mB` : '§7empty');
  }
  if (id === ID('basin')) {
    const d = basinGet(key);
    if (d.items.length) parts.push(`§7in: ${d.items.map((s) => `${s.n}x ${s.id.split(':')[1]}`).join(', ')}`);
    if (d.out.length) parts.push(`§7out: ${d.out.map((s) => `${s.n}x ${s.id.split(':')[1]}`).join(', ')}`);
    if (d.fluids.length) parts.push(`§b${d.fluids.map((f) => `${f.f} ${f.mb}mB`).join(', ')}`);
  }
  if (id === ID('depot')) {
    const d = depotGet(key);
    if (d.items.length) parts.push(`§7${d.items.map((s) => `${s.n}x ${s.id.split(':')[1]}`).join(', ')}`);
  }
  return parts.join('  §8|  ');
}

export function tickGoggles(): void {
  for (const p of players()) {
    if (!wearsGoggles(p)) continue;
    try {
      const hit = p.getBlockFromViewDirection({ maxDistance: 8 });
      if (!hit) continue;
      const t = goggleText(hit.block);
      if (t) actionbar(p, t);
    } catch {
      /* ignore */
    }
  }
}

// gauges show their value with the needle
export function gaugeValue(b: Block): number {
  const dim = b.dimension.id;
  if (b.typeId === ID('speedometer')) return Math.min(1, Math.abs(speedOf(dim, b.location)) / 256);
  const net = netOf(dim, b.location);
  if (!net || net.capacity <= 0) return 0;
  return Math.min(1, net.impact / net.capacity);
}

// ------------------------------------------------------------------ items (use in air)
export function itemUse(p: Player, item: ItemStack): void {
  switch (item.typeId) {
    case ID('engineers_manual'):
      openManual(p);
      break;
    case ID('filter'):
      openFilterUI(p);
      break;
    case ID('experience_nugget'): {
      const n = p.isSneaking ? item.amount : 1;
      p.addExperience(3 * n);
      consumeHeld(p, n);
      sound(p.dimension, 'craftoria.item_pop', p.location, 0.5, 1.5);
      break;
    }
    case ID('belt_connector'):
      msg(p, '§7Use the belt on two horizontal shafts in a line to connect them.');
      break;
    case ID('super_glue'):
      msg(p, '§7Use Super Glue on two blocks to glue the box between them. Sneak-use to remove glue.');
      break;
    default:
  }
}

const PAGES: [string, string][] = [
  ['Getting started', 'CRAFTORIA adds rotational power. Sources (Hand Crank, Water Wheel, Windmill, Creative Motor) turn Shafts and Cogwheels, which drive machines.\n\nEvery network has a SPEED (RPM) and a STRESS budget: capacity (SU) comes from sources, each machine consumes impact x RPM. Wear Engineer\'s Goggles (or hold the Wrench) and look at a block to see its speed and stress.'],
  ['Kinetics', 'Shafts connect end to end. Small cogwheels mesh side by side and reverse direction. A large cogwheel meshing diagonally with a small one doubles/halves speed. Gearboxes redirect rotation, Clutches disconnect and Gearshifts reverse when powered by redstone.\n\nIf two sources fight, gears form an impossible loop or a part exceeds 256 RPM the network JAMS and stops (nothing breaks - fix it and it restarts).'],
  ['Generators', 'Hand Crank: 32 RPM while you keep clicking (sneak to reverse).\nWater Wheel: up to 8 RPM / 256 SU from flowing water passing its sides.\nWindmill Bearing: glue a sail structure (8+ Sails) in front, right-click the bearing. 1 RPM per 8 sails, up to 16 RPM, 512 SU per RPM.\nCreative Motor: configurable (creative only).'],
  ['Processing', 'Mechanical Press: 2 blocks above a Depot/Belt (pressing) or Basin (compacting).\nMechanical Mixer: 2 blocks above a Basin, needs 30 RPM. Brass needs heat below the basin (lit campfire, fire, lava or magma).\nMillstone: right-click or feed items from above, outputs go to a container below.\nCrushing Wheels: two wheels with a 1-block gap, turning inward; drop items in from above.\nDrill / Saw: break blocks in front (the saw fells whole trees). An upward Saw cuts items on top.\nDeployer: holds an item; applies it to items on depots/belts, places blocks, bone-meals crops or attacks.\nEncased Fan: pushes entities; through water it washes items, through lava/fire it smelts them.'],
  ['Logistics', 'Mechanical Belt: use the belt item on two horizontal shafts in a line. Items ride on top, stop under presses/deployers/spouts and are handed to whatever is at the end.\nChute: moves items downwards.\nFunnels: attach to containers; right-click toggles insert/extract. Brass funnels filter (right-click with an item or a Filter). Redstone locks funnels.\nMechanical Arm: sneak-use the arm item on blocks before placing it to mark inputs (blue) and outputs (orange), range 5.'],
  ['Fluids', 'Fluid Pipes connect Pumps, Fluid Tanks, Basins and Spouts. A Mechanical Pump pushes fluid towards its front when turning one way and backwards the other way. Pipes ending in a water source draw infinite water; lava sources are consumed. Spouts fill bottles/buckets and items on depots or belts below them.'],
  ['Moving structures', 'Use Super Glue on two corners to glue a box: glued blocks move together (sails always stick).\nMechanical Bearing: right-click to assemble/disassemble. Sneak-right-click for door mode (90/180 degrees).\nRope Pulley: raises/lowers the structure below the rope. Sneak-right-click for elevator mode and use Elevator Contacts on each floor.\nMechanical Piston: place Piston Extension Poles behind it; it pushes the structure in front.'],
  ['Trains', 'Lay Train Track (curves connect automatically). Put a Train Station next to the track, build the train on the track, glue it, include Train Controls (and Seats). Use the station to assemble. Sit at the controls and press forward/back. Stations also offer an automatic shuttle. Train Signals turn red near other trains or when powered and stop trains.'],
];

function openManual(p: Player): void {
  const f = new ActionFormData().title("Engineer's Manual").body('CRAFTORIA: Mechanical Revolution');
  for (const [t] of PAGES) f.button(t);
  f.button('Settings');
  f.show(p).then((r) => {
    if (r.canceled || r.selection === undefined) return;
    if (r.selection === PAGES.length) return openSettings(p);
    const [title, body] = PAGES[r.selection];
    new ActionFormData().title(title).body(body).button('Back').show(p).then((r2) => {
      if (!r2.canceled) openManual(p);
    }).catch(() => undefined);
  }).catch(() => undefined);
}

function openSettings(p: Player): void {
  if (p.playerPermissionLevel < 2) {
    msg(p, '§cOnly operators can change CRAFTORIA settings.');
    return;
  }
  const f = new ModalFormData()
    .title('CRAFTORIA Settings')
    .toggle('Animated parts (rotor entities)', { defaultValue: settings.rotors })
    .toggle('Machine sounds', { defaultValue: settings.sounds })
    .slider('Particles (0 off, 1 reduced, 2 full)', 0, 2, { valueStep: 1, defaultValue: settings.particles })
    .slider('Max blocks per moving structure', 32, 512, { valueStep: 32, defaultValue: settings.maxContraptionBlocks });
  f.show(p).then((r) => {
    if (r.canceled || !r.formValues) return;
    settings.rotors = !!r.formValues[0];
    settings.sounds = !!r.formValues[1];
    settings.particles = Number(r.formValues[2]);
    settings.maxContraptionBlocks = Number(r.formValues[3]);
    saveSettings();
    msg(p, '§aSettings saved.');
  }).catch(() => undefined);
}

export { DIRS };
export type { V3 };
