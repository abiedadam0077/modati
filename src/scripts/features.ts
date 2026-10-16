// Feature aggregation: importing modules registers their handlers; ticking is wired here.
import { ItemStack, Player, world, system } from '@minecraft/server';
import { every } from './core/scheduler';
import { tickPressesAndMixers } from './machines/press_mixer';
import { tickGrinders } from './machines/grinders';
import { tickBreakers } from './machines/breakers';
import { tickDeployersAndFans } from './machines/deployer_fan';
import './machines/depot_basin';
import { tickBelts } from './logistics/belt';
import { tickChutes } from './logistics/chute_funnel';
import { tickArms } from './logistics/arm';
import { tickFluids } from './fluids/fluids';
import { loadContraptions, loadGlue, saveContraptions, showGlue, tickContraptions, refreshPulleyRopes } from './contraptions/contraption';
import { loadTrains, periodicTrainSave, sweepSeats, tickTrains } from './trains/trains';
import { gaugeValue, itemUse, tickGoggles } from './items/tools';
import { adoptDisplay, removeOrphanDisplays, sweepDisplays, ITEM_DISPLAY } from './visuals/displays';
import { allRotorKeys, rotorAt, ROTOR_PROPS } from './visuals/rotors';
import { blockAt, dimension } from './core/env';
import { parseDimKey } from './util/vec';
import { ID } from './kinetics/defs';

export function initFeatures(): void {
  loadGlue();
  loadContraptions();
  loadTrains();
  system.runTimeout(() => removeOrphanDisplays(), 30);
}

export function featureItemUse(source: Player, item: ItemStack | undefined): void {
  if (item) itemUse(source, item);
}

// first join: hand out the Engineer's Manual once per player
world.afterEvents.playerSpawn.subscribe((e) => {
  if (!e.initialSpawn) return;
  const p = e.player;
  system.runTimeout(() => {
    try {
      if (p.getDynamicProperty('cr:manual')) return;
      p.setDynamicProperty('cr:manual', true);
      p.getComponent('minecraft:inventory')?.container?.addItem(new ItemStack('craftoria:engineers_manual', 1));
      p.sendMessage("§6[CRAFTORIA] §fWelcome! Open the §eEngineer's Manual§f to learn about kinetic machines.");
    } catch {
      /* ignore */
    }
  }, 40);
});

world.afterEvents.entityLoad.subscribe((e) => {
  try {
    if (e.entity.typeId === ITEM_DISPLAY) system.run(() => adoptDisplay(e.entity));
  } catch {
    /* ignore */
  }
});

function tickGauges(): void {
  for (const key of allRotorKeys()) {
    const e = rotorAt(key);
    if (!e) continue;
    const { dim, pos } = parseDimKey(key);
    const b = blockAt(dimension(dim), pos);
    if (!b || (b.typeId !== ID('speedometer') && b.typeId !== ID('stressometer'))) continue;
    const v = Math.round(gaugeValue(b) * 240 - 120);
    try {
      if (e.getProperty(ROTOR_PROPS.p1) !== v) e.setProperty(ROTOR_PROPS.p1, v);
    } catch {
      /* ignore */
    }
  }
}

every('press_mixer', 1, tickPressesAndMixers);
every('grinders', 1, tickGrinders);
every('breakers', 1, tickBreakers);
every('deployer_fan', 1, tickDeployersAndFans);
every('belts', 1, tickBelts);
every('chutes', 1, tickChutes);
every('arms', 1, tickArms);
every('fluids', 1, tickFluids);
every('contraptions', 1, tickContraptions);
every('trains', 1, tickTrains);
every('goggles', 5, tickGoggles, 1);
every('gauges', 10, tickGauges, 5);
every('displays_sweep', 20, sweepDisplays, 9);
every('glue_show', 20, showGlue, 4);
every('contraption_save', 200, saveContraptions, 17);
every('train_save', 400, periodicTrainSave, 33);
every('seat_sweep', 100, sweepSeats, 41);
every('pulley_ropes', 40, refreshPulleyRopes, 23);
