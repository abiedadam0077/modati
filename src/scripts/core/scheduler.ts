// Central tick scheduler: a single runInterval drives every CRAFTORIA system with
// per-task periods and phase offsets, isolating errors per task.
import { system } from '@minecraft/server';
import { logError } from './env';

interface Task {
  name: string;
  period: number;
  phase: number;
  fn: (tick: number) => void;
  totalMs: number;
  runs: number;
}

const tasks: Task[] = [];
let started = false;
let tickCount = 0;

export function every(name: string, period: number, fn: (tick: number) => void, phase = 0): void {
  tasks.push({ name, period: Math.max(1, Math.floor(period)), phase: phase % Math.max(1, period), fn, totalMs: 0, runs: 0 });
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  system.runInterval(() => {
    tickCount++;
    const t = system.currentTick;
    for (const task of tasks) {
      if ((t + task.phase) % task.period !== 0) continue;
      const t0 = Date.now();
      try {
        task.fn(t);
      } catch (e) {
        logError(`task ${task.name}`, e);
      }
      task.totalMs += Date.now() - t0;
      task.runs++;
    }
  }, 1);
}

/** Profiling snapshot for /craftoria:debug */
export function profile(): { name: string; avgMs: number; runs: number }[] {
  return tasks.map((t) => ({ name: t.name, avgMs: t.runs ? t.totalMs / t.runs : 0, runs: t.runs }));
}
export function resetProfile(): void {
  for (const t of tasks) {
    t.totalMs = 0;
    t.runs = 0;
  }
}
export function ticksRun(): number {
  return tickCount;
}
