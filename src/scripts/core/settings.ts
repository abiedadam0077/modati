// World-level settings (persisted). Changed with /craftoria:settings or the Engineer's Manual form.
import { globalStore } from './store';

export interface Settings {
  /** spawn rotor entities for animated parts (false = static models, best for low-end devices) */
  rotors: boolean;
  /** machine sounds */
  sounds: boolean;
  /** particles: 0 none, 1 reduced, 2 full */
  particles: number;
  /** show fault messages in chat */
  faultMessages: boolean;
  /** maximum blocks per contraption */
  maxContraptionBlocks: number;
  debug: boolean;
}

export const settings: Settings = {
  rotors: true,
  sounds: true,
  particles: 2,
  faultMessages: true,
  maxContraptionBlocks: 256,
  debug: false,
};

export function loadSettings(): void {
  const s = globalStore.get<Partial<Settings>>('settings');
  if (s) Object.assign(settings, s);
}

export function saveSettings(): void {
  globalStore.set('settings', settings);
}
