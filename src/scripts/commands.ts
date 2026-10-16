// Custom slash commands (/craftoria:debug, /craftoria:settings, /craftoria:rebuild).
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, CustomCommandStatus, system } from '@minecraft/server';
import { profile, resetProfile } from './core/scheduler';
import { settings, saveSettings } from './core/settings';
import { networkCount } from './kinetics/network';
import { rotorCount, allRotorKeys, removeRotor } from './visuals/rotors';
import { displayCount } from './visuals/displays';
import { activeCount } from './machines/active';
import { contraptionCount } from './contraptions/contraption';
import { trainCount } from './trains/trains';

export function registerCommands(reg: CustomCommandRegistry): void {
  reg.registerCommand(
    { name: 'craftoria:debug', description: 'CRAFTORIA: show performance and system counters', permissionLevel: CommandPermissionLevel.GameDirectors },
    () => {
      const prof = profile().filter((p) => p.runs > 0).sort((a, b) => b.avgMs - a.avgMs).slice(0, 8);
      const lines = [
        `networks=${networkCount()} rotors=${rotorCount()} displays=${displayCount()} activeMachines=${activeCount()} contraptions=${contraptionCount()} trains=${trainCount()}`,
        ...prof.map((p) => `${p.name}: ${p.avgMs.toFixed(3)} ms avg (${p.runs} runs)`),
      ];
      system.run(() => resetProfile());
      return { status: CustomCommandStatus.Success, message: lines.join('\n') };
    },
  );
  reg.registerEnum('craftoria:setting', ['rotors', 'sounds', 'particles', 'maxblocks']);
  reg.registerCommand(
    {
      name: 'craftoria:settings',
      description: 'CRAFTORIA: change a world setting (rotors|sounds on/off, particles 0-2, maxblocks n)',
      permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [{ name: 'craftoria:setting', type: CustomCommandParamType.Enum }, { name: 'value', type: CustomCommandParamType.Integer }],
    },
    (_o, key: string, value: number) => {
      system.run(() => {
        if (key === 'rotors') settings.rotors = value !== 0;
        else if (key === 'sounds') settings.sounds = value !== 0;
        else if (key === 'particles') settings.particles = Math.max(0, Math.min(2, value));
        else if (key === 'maxblocks') settings.maxContraptionBlocks = Math.max(16, Math.min(1024, value));
        saveSettings();
      });
      return { status: CustomCommandStatus.Success, message: `CRAFTORIA setting ${key} = ${value}` };
    },
  );
  reg.registerCommand(
    { name: 'craftoria:rebuild', description: 'CRAFTORIA: respawn all animated parts (fixes visual glitches)', permissionLevel: CommandPermissionLevel.GameDirectors },
    () => {
      system.run(() => {
        for (const k of allRotorKeys()) removeRotor(k);
      });
      return { status: CustomCommandStatus.Success, message: 'Animated parts will be respawned around players.' };
    },
  );
}
