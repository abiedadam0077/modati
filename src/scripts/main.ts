// CRAFTORIA: Mechanical Revolution — script entry point.
import { BlockComponentRegistry, ItemComponentRegistry, StartupEvent, system, world } from '@minecraft/server';
import { every, startScheduler } from './core/scheduler';
import { flushAllStores } from './core/store';
import { loadSettings } from './core/settings';
import { logError, getStates } from './core/env';
import { beforePlace } from './blocks/placement';
import { handlersOf } from './machines/registry';
import { KINETIC_DEFS, S_POWERED, isKinetic, ID } from './kinetics/defs';
import { markTopologyDirty, processNetworks, isKnownNode, indexAdd, indexRemove, onSpeedChange, resolveAll } from './kinetics/network';
import { initGenerators, tickCranks, updateWaterWheel } from './kinetics/generators';
import { adoptRotor, configureRotor, removeRotor, rotorAt, scanExistingRotors, tickRotorLOD, updateRotorSpeed, validateRotors, ROTOR_ENTITY } from './visuals/rotors';
import { dimKey } from './util/vec';
import { initFeatures, featureItemUse } from './features';
import { registerCommands } from './commands';

// ---------------------------------------------------------------------------------------------
// custom components
function registerBlockComponents(reg: BlockComponentRegistry): void {
  reg.registerCustomComponent('craftoria:orient', {
    beforeOnPlayerPlace: (e, p) => {
      try {
        const mode = (p.params as { mode?: string } | undefined)?.mode ?? 'none';
        beforePlace(e, mode);
      } catch (err) {
        logError('orient', err);
      }
    },
  });

  reg.registerCustomComponent('craftoria:kinetic', {
    onPlace: (e) => {
      const b = e.block;
      indexAdd(b.dimension.id, b.location);
      markTopologyDirty(b.dimension.id, b.location);
    },
    onBreak: (e) => {
      const b = e.block;
      const key = dimKey(b.dimension.id, b.location);
      removeRotor(key, false);
      indexRemove(b.dimension.id, b.location);
      markTopologyDirty(b.dimension.id, b.location);
    },
    onTick: (e) => {
      const b = e.block;
      try {
        const def = KINETIC_DEFS[b.typeId];
        if (!def) return;
        const dim = b.dimension.id;
        if (!isKnownNode(dim, b.location)) {
          indexAdd(dim, b.location);
          markTopologyDirty(dim, b.location);
        }
        if (def.redstone) {
          const powered = (b.getRedstonePower() ?? 0) > 0;
          const st = getStates(b);
          if (!!st[S_POWERED] !== powered) {
            b.setPermutation(b.permutation.withState(S_POWERED as never, powered as never));
            markTopologyDirty(dim, b.location);
          }
        }
        if (def.generator === 'water_wheel') updateWaterWheel(b);
      } catch (err) {
        logError('kinetic.onTick', err);
      }
    },
  });

  reg.registerCustomComponent('craftoria:machine', {
    onPlace: (e) => {
      for (const h of handlersOf(e.block.typeId)) h.onPlace?.(e.block);
    },
    onBreak: (e) => {
      const tid = e.brokenBlockPermutation.type.id;
      for (const h of handlersOf(tid)) {
        try {
          h.onBreak?.(e.block.dimension.id, e.block.location, e.brokenBlockPermutation);
        } catch (err) {
          logError(`machine.onBreak ${tid}`, err);
        }
      }
    },
    onPlayerInteract: (e) => {
      if (!e.player) return;
      for (const h of handlersOf(e.block.typeId)) {
        try {
          if (h.onInteract?.(e.block, e.player, e.face)) return;
        } catch (err) {
          logError(`machine.onInteract ${e.block.typeId}`, err);
        }
      }
    },
    onTick: (e) => {
      for (const h of handlersOf(e.block.typeId)) {
        try {
          h.onTick?.(e.block);
        } catch (err) {
          logError(`machine.onTick ${e.block.typeId}`, err);
        }
      }
    },
  });
}

function registerItemComponents(reg: ItemComponentRegistry): void {
  reg.registerCustomComponent('craftoria:tool', {
    onUse: (e) => {
      try {
        featureItemUse(e.source, e.itemStack);
      } catch (err) {
        logError('tool.onUse', err);
      }
    },
  });
}

system.beforeEvents.startup.subscribe((ev: StartupEvent) => {
  registerBlockComponents(ev.blockComponentRegistry);
  registerItemComponents(ev.itemComponentRegistry);
  registerCommands(ev.customCommandRegistry);
});

// ---------------------------------------------------------------------------------------------
// visuals follow speed changes
onSpeedChange((dim, node) => {
  const key = dimKey(dim, node.pos);
  if (rotorAt(key)) updateRotorSpeed(key);
});

world.afterEvents.entityLoad.subscribe((e) => {
  try {
    if (e.entity.typeId === ROTOR_ENTITY) system.run(() => adoptRotor(e.entity));
  } catch {
    /* entity gone */
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  loadSettings();
  initGenerators();
  initFeatures();
  system.runTimeout(() => scanExistingRotors(), 20);
  startScheduler();
});

// ---------------------------------------------------------------------------------------------
every('networks', 1, () => processNetworks(3000));
every('cranks', 2, () => tickCranks());
every('rotor_lod', 10, () => tickRotorLOD(), 3);
every('rotor_validate', 100, () => validateRotors(), 7);
every('store_flush', 40, () => flushAllStores(200), 11);
every('water_resolve', 40, () => resolveAll((n) => n.nodes.some((c) => c.typeId === ID('water_wheel'))), 13);

export { isKinetic, configureRotor };
