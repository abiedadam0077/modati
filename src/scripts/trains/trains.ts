// Simplified trains: auto-connecting tracks (straight + 90° curves, flat), stations, signals,
// train controls (driven by the seated player's movement input) and an automatic shuttle mode.
// Every block of a train follows the track path (smooth curves), riders sit on seat entities.
import { Block, BlockPermutation, Dimension, Entity, Player, system, world, EntityDamageCause } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { DIR_VEC, Dir, HORIZONTAL, OPPOSITE, V3, dimKey, offset, posKey, dominantHorizontal } from '../util/vec';
import { blockAt, dimension, getStates, logError, msg, players, setStates, now } from '../core/env';
import { globalStore } from '../core/store';
import { ID, facingOf } from '../kinetics/defs';
import { registerMachine } from '../machines/registry';
import { collectStructure, inGlue } from '../contraptions/contraption';
import { CONTRAPTION_TABLE } from '../generated/contraption_table';
import { dropItem } from '../logistics/transport';
import { sound } from '../machines/common';

const TRACK = ID('track');
const STATION = ID('train_station');
const SIGNAL = ID('train_signal');
const CONTROLS = ID('train_controls');
const SEAT = ID('seat');
const SEAT_ENTITY = 'craftoria:seat_entity';
const BLOCK_DISPLAY = 'craftoria:block_display';

type Shape = 'ns' | 'ew' | 'ne' | 'es' | 'sw' | 'wn';
const SHAPE_CONN: Record<Shape, [Dir, Dir]> = { ns: ['north', 'south'], ew: ['east', 'west'], ne: ['north', 'east'], es: ['east', 'south'], sw: ['south', 'west'], wn: ['west', 'north'] };

export function shapeFor(a: Dir, b: Dir): Shape | undefined {
  for (const [s, c] of Object.entries(SHAPE_CONN) as [Shape, [Dir, Dir]][]) if ((c[0] === a && c[1] === b) || (c[0] === b && c[1] === a)) return s;
  return undefined;
}
function shapeOf(b: Block | undefined): Shape | undefined {
  if (!b || b.typeId !== TRACK) return undefined;
  return getStates(b)['craftoria:shape'] as Shape;
}
function connections(b: Block | undefined): Dir[] {
  const s = shapeOf(b);
  return s ? [...SHAPE_CONN[s]] : [];
}

// ------------------------------------------------------------------ track shaping
function trackNeighbors(dim: Dimension, p: V3): Dir[] {
  return (HORIZONTAL as Dir[]).filter((d) => blockAt(dim, offset(p, d))?.typeId === TRACK);
}
function wantsConnection(dim: Dimension, p: V3, toward: Dir): boolean {
  const nb = blockAt(dim, offset(p, toward));
  if (!nb || nb.typeId !== TRACK) return false;
  const conn = connections(nb);
  if (conn.includes(OPPOSITE[toward])) return true;
  // neighbour has a free end?
  const used = conn.filter((d) => blockAt(dim, offset(nb.location, d))?.typeId === TRACK);
  return used.length < 2;
}
export function reshapeTrack(dim: Dimension, p: V3, preferred?: Dir): void {
  const b = blockAt(dim, p);
  if (!b || b.typeId !== TRACK) return;
  const ns = trackNeighbors(dim, p).filter((d) => wantsConnection(dim, p, d));
  let shape: Shape | undefined;
  if (ns.length >= 2) {
    // prefer straight connections
    if (ns.includes('north') && ns.includes('south')) shape = 'ns';
    else if (ns.includes('east') && ns.includes('west')) shape = 'ew';
    else shape = shapeFor(ns[0], ns[1]);
  } else if (ns.length === 1) shape = ns[0] === 'north' || ns[0] === 'south' ? 'ns' : 'ew';
  else shape = preferred === 'east' || preferred === 'west' ? 'ew' : 'ns';
  if (shape) setStates(b, { 'craftoria:shape': shape });
}

// ------------------------------------------------------------------ path geometry
interface Cell {
  p: V3;
  inDir: Dir; // travel direction when entering
  outDir: Dir; // travel direction when leaving
}
function pointOn(c: Cell, f: number): { x: number; z: number; hx: number; hz: number } {
  const ci = DIR_VEC[c.inDir], co = DIR_VEC[c.outDir];
  const cx = c.p.x + 0.5, cz = c.p.z + 0.5;
  if (c.inDir === c.outDir) {
    return { x: cx + ci.x * (f - 0.5), z: cz + ci.z * (f - 0.5), hx: ci.x, hz: ci.z };
  }
  // quarter circle around the corner between entry and exit edges
  const ox = cx - ci.x * 0.5 + co.x * 0.5, oz = cz - ci.z * 0.5 + co.z * 0.5;
  const sx = cx - ci.x * 0.5 - ox, sz = cz - ci.z * 0.5 - oz; // start vector (radius 0.5)
  const ex = cx + co.x * 0.5 - ox, ez = cz + co.z * 0.5 - oz;
  const a0 = Math.atan2(sz, sx), a1raw = Math.atan2(ez, ex);
  let da = a1raw - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const a = a0 + da * f;
  const x = ox + Math.cos(a) * 0.5, z = oz + Math.sin(a) * 0.5;
  const t = Math.sign(da);
  return { x, z, hx: -Math.sin(a) * t, hz: Math.cos(a) * t };
}

// ------------------------------------------------------------------ trains
interface TBlock {
  a: number; // cells behind the head cell
  lat: number; // lateral offset (+ right of travel)
  y: number;
  id: string;
  st: Record<string, string | number | boolean>;
}
interface Train {
  id: number;
  dim: string;
  blocks: TBlock[];
  cells: Cell[]; // cells[0] = front-most cell (towards +travel)
  pos: number; // progress of the front within cells[0] (0..1)
  v: number; // blocks per tick (+ forward)
  heading0: Dir;
  ents: string[];
  seats: { id: string; b: number; controls: boolean }[];
  auto: boolean;
  wait: number;
  autoDir: number;
  station?: string;
}
const trains = new Map<number, Train>();
let nextTrain = 1;

export function trainCount(): number {
  return trains.size;
}

function forwardCell(dim: Dimension, c: Cell): Cell | undefined {
  const np = offset(c.p, c.outDir);
  const nb = blockAt(dim, np);
  const conn = connections(nb);
  const back = OPPOSITE[c.outDir];
  if (!conn.includes(back)) return undefined;
  const out = conn[0] === back ? conn[1] : conn[0];
  return { p: np, inDir: c.outDir, outDir: out };
}
function backwardCell(dim: Dimension, c: Cell): Cell | undefined {
  const np = offset(c.p, OPPOSITE[c.inDir]);
  const nb = blockAt(dim, np);
  const conn = connections(nb);
  if (!conn.includes(c.inDir)) return undefined;
  const other = conn[0] === c.inDir ? conn[1] : conn[0];
  return { p: np, inDir: OPPOSITE[other], outDir: c.inDir };
}

function trainLength(t: Train): number {
  return Math.max(...t.blocks.map((b) => b.a)) + 1;
}

/** world point at path distance d behind the front (d >= 0). */
function samplePath(t: Train, d: number): { x: number; z: number; hx: number; hz: number; cell: Cell } | undefined {
  let u = t.pos - d; // relative to cells[0] start
  let i = 0;
  while (u < 0 && i < t.cells.length - 1) {
    u += 1;
    i++;
  }
  const c = t.cells[i];
  if (!c) return undefined;
  const f = Math.max(0, Math.min(1, u));
  return { ...pointOn(c, f), cell: c };
}

function yawOf(hx: number, hz: number): number {
  return (Math.atan2(hx, hz) * 180) / Math.PI;
}

function spawnTrainDisplays(t: Train): void {
  const dim = dimension(t.dim);
  for (const tb of t.blocks) {
    try {
      const e = dim.spawnEntity(BLOCK_DISPLAY, { x: 0, y: 0, z: 0 }, { initialRotation: 0 });
      // placed correctly on the first tick
      const set = (k: string, v: number) => e.setProperty(`craftoria:${k}`, v);
      set('dir', 1);
      set('oy', 0);
      const custom = CONTRAPTION_TABLE.custom[tb.id];
      const own = CONTRAPTION_TABLE.own[tb.id];
      const van = CONTRAPTION_TABLE.vanilla[tb.id];
      if (custom !== undefined) set('geo', custom);
      else if (own !== undefined) {
        set('tex', own);
        set('tex2', own);
      } else if (van) {
        set('tex', van[0]);
        set('tex2', van[1]);
      } else {
        set('geo', 1);
        try {
          e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${tb.id} 1`);
        } catch {
          /* ignore */
        }
      }
      const facing = tb.st['craftoria:facing'];
      if (typeof facing === 'string' && facing in DIR_VEC) set('bdir', { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 }[facing as Dir]);
      e.setDynamicProperty('cr:t', t.id);
      t.ents.push(e.id);
    } catch (err) {
      logError('train display', err);
    }
  }
  t.blocks.forEach((tb, i) => {
    if (tb.id !== SEAT && tb.id !== CONTROLS) return;
    try {
      const s = dim.spawnEntity(SEAT_ENTITY, { x: 0, y: 0, z: 0 }, { initialRotation: 0 });
      s.setDynamicProperty('cr:t', t.id);
      t.seats.push({ id: s.id, b: i, controls: tb.id === CONTROLS });
    } catch (err) {
      logError('train seat', err);
    }
  });
}

function placeTrainVisuals(t: Train): void {
  const yaw0 = yawOf(DIR_VEC[t.heading0].x, DIR_VEC[t.heading0].z);
  t.blocks.forEach((tb, i) => {
    const s = samplePath(t, tb.a + 0.5);
    if (!s) return;
    const rx = -s.hz, rz = s.hx; // right-hand side of travel
    const base = s.cell.p.y + 1;
    const loc = { x: s.x + rx * tb.lat, y: base + tb.y, z: s.z + rz * tb.lat };
    const e = world.getEntity(t.ents[i]);
    if (!e?.isValid) return;
    try {
      e.teleport(loc, { keepVelocity: false });
      const yaw = yawOf(s.hx, s.hz) - yaw0;
      const ph = ((Math.round(yaw * 10) / 10) % 360 + 360) % 360;
      if (e.getProperty('craftoria:phase') !== ph) e.setProperty('craftoria:phase', ph);
    } catch {
      /* ignore */
    }
  });
  for (const seat of t.seats) {
    const tb = t.blocks[seat.b];
    const s = samplePath(t, tb.a + 0.5);
    const e = world.getEntity(seat.id);
    if (!s || !e?.isValid) continue;
    const rx = -s.hz, rz = s.hx;
    try {
      e.teleport({ x: s.x + rx * tb.lat, y: s.cell.p.y + 1 + tb.y + 0.45, z: s.z + rz * tb.lat }, { keepVelocity: false });
    } catch {
      /* ignore */
    }
  }
}

function assembleTrain(st: Block, p: Player): void {
  const dim = st.dimension;
  // track next to the station
  let trackPos: V3 | undefined;
  for (const d of HORIZONTAL as Dir[]) {
    const tp = offset(st.location, d);
    if (blockAt(dim, tp)?.typeId === TRACK) {
      trackPos = tp;
      break;
    }
  }
  if (!trackPos) {
    msg(p, '§cPlace the station directly beside a track.');
    return;
  }
  const shape = shapeOf(blockAt(dim, trackPos));
  if (shape !== 'ns' && shape !== 'ew') {
    msg(p, '§cTrains must be assembled on straight track.');
    return;
  }
  const above = offset(trackPos, 'up');
  const cells = collectStructure(dim, above, st.location);
  if (!cells.length) {
    msg(p, '§cBuild the train on top of the track (glue its blocks together with Super Glue).');
    return;
  }
  const hasControls = cells.some((c) => blockAt(dim, c)?.typeId === CONTROLS);
  if (!hasControls) {
    msg(p, '§cA train needs Train Controls.');
    return;
  }
  // heading: towards the controls facing (or the track direction)
  const ctrl = cells.find((c) => blockAt(dim, c)?.typeId === CONTROLS)!;
  let heading = facingOf(getStates(blockAt(dim, ctrl)!));
  if (!SHAPE_CONN[shape].includes(heading)) heading = SHAPE_CONN[shape][0];
  const hv = DIR_VEC[heading];
  const along = (c: V3) => (c.x - trackPos!.x) * hv.x + (c.z - trackPos!.z) * hv.z; // + towards heading
  const maxAlong = Math.max(...cells.map(along));
  // every column of the train must sit above track
  const tbs: TBlock[] = [];
  const right = { x: -hv.z, z: hv.x };
  for (const c of cells) {
    const b = blockAt(dim, c)!;
    const a = maxAlong - along(c);
    const lat = (c.x - trackPos.x) * right.x + (c.z - trackPos.z) * right.z;
    tbs.push({ a, lat, y: c.y - above.y, id: b.typeId, st: getStates(b) });
  }
  // build the cell list from the front backwards along the straight track
  const frontPos = { x: trackPos.x + hv.x * maxAlong, y: trackPos.y, z: trackPos.z + hv.z * maxAlong };
  const len = Math.max(...tbs.map((t) => t.a)) + 1;
  const cellList: Cell[] = [];
  for (let i = 0; i < len + 1; i++) {
    const cp = { x: frontPos.x - hv.x * i, y: frontPos.y, z: frontPos.z - hv.z * i };
    if (blockAt(dim, cp)?.typeId !== TRACK) {
      if (i < len) {
        msg(p, '§cThe whole train must stand on track.');
        return;
      }
      break;
    }
    cellList.push({ p: cp, inDir: heading, outDir: heading });
  }
  for (const c of [...cells].sort((a, b) => b.y - a.y)) {
    try {
      dim.setBlockType(c, 'minecraft:air');
    } catch {
      /* ignore */
    }
  }
  const t: Train = { id: nextTrain++, dim: dim.id, blocks: tbs, cells: cellList, pos: 0.5, v: 0, heading0: heading, ents: [], seats: [], auto: false, wait: 0, autoDir: 1, station: dimKey(dim.id, st.location) };
  trains.set(t.id, t);
  spawnTrainDisplays(t);
  system.run(() => placeTrainVisuals(t));
  sound(dim, 'craftoria.train_horn', st.center(), 0.8);
  msg(p, `§aTrain assembled (${tbs.length} blocks). Sit at the Train Controls and use forward/back to drive, or start the auto shuttle from a station.`);
  saveTrains();
}

function disassembleTrain(t: Train, p?: Player): boolean {
  const dim = dimension(t.dim);
  // must be aligned on straight track at a whole cell
  const head = t.cells[0];
  if (Math.abs(t.v) > 0.01) {
    if (p) msg(p, '§cStop the train first.');
    return false;
  }
  for (const tb of t.blocks) {
    const s = samplePath(t, tb.a + 0.5);
    if (!s || s.cell.inDir !== s.cell.outDir) {
      if (p) msg(p, '§cTrains can only be disassembled on straight track.');
      return false;
    }
  }
  const quarter = Math.round(((yawOf(DIR_VEC[head.outDir].x, DIR_VEC[head.outDir].z) - yawOf(DIR_VEC[t.heading0].x, DIR_VEC[t.heading0].z)) / 90 + 4) % 4);
  for (const tb of t.blocks) {
    const s = samplePath(t, tb.a + 0.5)!;
    const rx = -s.hz, rz = s.hx;
    const cp = { x: Math.floor(s.x + rx * tb.lat), y: s.cell.p.y + 1 + tb.y, z: Math.floor(s.z + rz * tb.lat) };
    const b = blockAt(dim, cp);
    if (!b || !(b.isAir || b.typeId === 'minecraft:air')) {
      dropItem(dim, { x: cp.x + 0.5, y: cp.y + 0.5, z: cp.z + 0.5 }, { id: tb.id, n: 1 });
      continue;
    }
    try {
      let perm = BlockPermutation.resolve(tb.id);
      for (const [k, v] of Object.entries(tb.st)) {
        let val = v;
        if ((k === 'craftoria:facing' || k === 'minecraft:cardinal_direction') && typeof v === 'string' && (HORIZONTAL as string[]).includes(v)) {
          const order: Dir[] = ['north', 'east', 'south', 'west'];
          val = order[(order.indexOf(v as Dir) + 4 - quarter) % 4];
        }
        try {
          perm = perm.withState(k as never, val as never);
        } catch {
          /* ignore */
        }
      }
      b.setPermutation(perm);
    } catch {
      dropItem(dim, { x: cp.x + 0.5, y: cp.y + 0.5, z: cp.z + 0.5 }, { id: tb.id, n: 1 });
    }
  }
  removeTrainEntities(t);
  trains.delete(t.id);
  saveTrains();
  return true;
}

function removeTrainEntities(t: Train): void {
  for (const id of [...t.ents, ...t.seats.map((s) => s.id)]) {
    try {
      const e = world.getEntity(id);
      if (e?.isValid) e.remove();
    } catch {
      /* ignore */
    }
  }
  t.ents = [];
  t.seats = [];
}

// ------------------------------------------------------------------ signals
function signalRed(dim: Dimension, sp: V3, except: number): boolean {
  const b = blockAt(dim, sp);
  if (!b) return false;
  if ((b.getRedstonePower() ?? 0) > 0) return true;
  for (const t of trains.values()) {
    if (t.id === except || t.dim !== dim.id) continue;
    for (const c of t.cells.slice(0, trainLength(t) + 1)) {
      if (Math.abs(c.p.x - sp.x) + Math.abs(c.p.z - sp.z) <= 12 && Math.abs(c.p.y - sp.y) <= 3) return true;
    }
  }
  return false;
}
function signalAhead(t: Train, cell: Cell): V3 | undefined {
  const dim = dimension(t.dim);
  for (const d of HORIZONTAL as Dir[]) {
    const sp = offset(cell.p, d);
    if (blockAt(dim, sp)?.typeId === SIGNAL) return sp;
  }
  return undefined;
}

// ------------------------------------------------------------------ movement
function stationAt(dim: Dimension, cell: Cell): string | undefined {
  for (const d of HORIZONTAL as Dir[]) {
    const sp = offset(cell.p, d);
    if (blockAt(dim, sp)?.typeId === STATION) return dimKey(dim.id, sp);
  }
  return undefined;
}

function driverInput(t: Train): number {
  for (const s of t.seats) {
    if (!s.controls) continue;
    const e = world.getEntity(s.id);
    if (!e?.isValid) continue;
    const riders = e.getComponent('minecraft:rideable')?.getRiders() ?? [];
    for (const r of riders) {
      if (r.typeId !== 'minecraft:player') continue;
      try {
        const mv = (r as Player).inputInfo.getMovementVector();
        return mv.y;
      } catch {
        return 0;
      }
    }
  }
  return 0;
}

function tickTrain(t: Train): void {
  const dim = dimension(t.dim);
  if (!blockAt(dim, t.cells[0].p)) return; // unloaded
  const input = driverInput(t);
  const MAX = 0.6;
  if (input !== 0) {
    t.auto = false;
    t.v = Math.max(-MAX * 0.5, Math.min(MAX, t.v + input * 0.01));
  } else if (t.auto) {
    if (t.wait > 0) {
      t.wait--;
      t.v = 0;
      if (t.wait === 0) t.autoDir = -t.autoDir;
    } else t.v += (t.autoDir * 0.3 - t.v) * 0.05;
  } else t.v *= 0.985; // coasting friction
  if (Math.abs(t.v) < 0.001) t.v = 0;
  // curve speed limit
  if (t.cells[0].inDir !== t.cells[0].outDir) t.v = Math.max(-0.25, Math.min(0.25, t.v));
  if (t.v === 0) return;
  const len = trainLength(t);
  if (t.v > 0) {
    // signal / obstacle ahead
    const ahead = forwardCell(dim, t.cells[0]);
    if (t.pos + t.v >= 1) {
      if (!ahead) {
        t.v = 0;
        t.pos = 1;
        return;
      }
      const sig = signalAhead(t, ahead);
      if (sig && signalRed(dim, sig, t.id)) {
        t.v = 0;
        return;
      }
      t.pos -= 1;
      t.cells.unshift(ahead);
      if (t.cells.length > len + 2) t.cells.length = len + 2;
      // auto stop at stations
      const stn = stationAt(dim, ahead);
      if (t.auto && stn && stn !== t.station) {
        t.station = stn;
        t.wait = 100;
        sound(dim, 'craftoria.station_chime', { x: ahead.p.x + 0.5, y: ahead.p.y + 1, z: ahead.p.z + 0.5 }, 0.8);
      }
      hurtAt(dim, ahead.p, t.v);
    }
    t.pos += t.v;
  } else {
    // reversing: extend at the tail
    while (t.cells.length < len + 2) {
      const tail = t.cells[t.cells.length - 1];
      const prev = backwardCell(dim, tail);
      if (!prev) break;
      t.cells.push(prev);
    }
    const needBehind = len; // cells needed behind the front after moving
    if (t.pos + t.v < 0) {
      if (t.cells.length < needBehind + 2) {
        t.v = 0;
        return;
      }
      t.cells.shift();
      t.pos += 1;
      const stn = stationAt(dim, t.cells[t.cells.length - 1]);
      if (t.auto && stn && stn !== t.station) {
        t.station = stn;
        t.wait = 100;
      }
    }
    t.pos += t.v;
  }
  placeTrainVisuals(t);
  if (now() % 30 === 0 && Math.abs(t.v) > 0.05) sound(dim, 'craftoria.train_move', { x: t.cells[0].p.x + 0.5, y: t.cells[0].p.y + 1, z: t.cells[0].p.z + 0.5 }, 0.5, 0.7 + Math.abs(t.v));
}

function hurtAt(dim: Dimension, p: V3, v: number): void {
  if (Math.abs(v) < 0.15) return;
  try {
    for (const e of dim.getEntities({ location: { x: p.x + 0.5, y: p.y + 1.5, z: p.z + 0.5 }, maxDistance: 1.2 })) {
      if (e.typeId === 'minecraft:item' || e.typeId.startsWith('craftoria:')) continue;
      const r = e.getComponent('minecraft:riding');
      if (r) continue;
      e.applyDamage(Math.ceil(Math.abs(v) * 20), { cause: EntityDamageCause.contact });
    }
  } catch {
    /* ignore */
  }
}

export function tickTrains(): void {
  for (const t of trains.values()) {
    try {
      tickTrain(t);
    } catch (e) {
      logError('train', e);
    }
  }
  if (now() % 10 === 0) updateSignalLamps();
}

function updateSignalLamps(): void {
  for (const t of trains.values()) {
    const dim = dimension(t.dim);
    for (const c of t.cells.slice(0, 4)) {
      for (const d of HORIZONTAL as Dir[]) {
        const sp = offset(c.p, d);
        const b = blockAt(dim, sp);
        if (b?.typeId === SIGNAL) setStates(b, { 'craftoria:red': true });
      }
    }
  }
}

// ------------------------------------------------------------------ persistence
interface SavedTrain extends Omit<Train, 'ents' | 'seats'> {}
function saveTrains(): void {
  globalStore.set('trains', [...trains.values()].map((t) => ({ ...t, ents: undefined, seats: undefined })));
}
export function loadTrains(): void {
  const list = globalStore.get<SavedTrain[]>('trains') ?? [];
  for (const s of list) {
    const t: Train = { ...s, ents: [], seats: [], v: 0 };
    trains.set(t.id, t);
    nextTrain = Math.max(nextTrain, t.id + 1);
  }
  system.runTimeout(() => {
    for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
      try {
        const d = world.getDimension(id);
        for (const e of d.getEntities({ type: SEAT_ENTITY })) if (e.getDynamicProperty('cr:t') !== undefined) e.remove();
      } catch {
        /* ignore */
      }
    }
    for (const t of trains.values()) {
      spawnTrainDisplays(t);
      placeTrainVisuals(t);
    }
  }, 60);
}
export function periodicTrainSave(): void {
  if (trains.size) saveTrains();
}

// ------------------------------------------------------------------ blocks
function stationMenu(b: Block, p: Player): void {
  const dim = b.dimension;
  const here = [...trains.values()].find((t) => t.dim === dim.id && t.cells.slice(0, trainLength(t) + 1).some((c) => Math.abs(c.p.x - b.location.x) + Math.abs(c.p.z - b.location.z) <= 2 && Math.abs(c.p.y - b.location.y) <= 1));
  const form = new ActionFormData().title('Train Station');
  const actions: (() => void)[] = [];
  if (here) {
    form.body(`Train #${here.id} (${here.blocks.length} blocks) is at this station.`);
    form.button(here.auto ? 'Stop auto shuttle' : 'Start auto shuttle');
    actions.push(() => {
      here.auto = !here.auto;
      here.station = dimKey(dim.id, b.location);
      here.wait = 40;
      msg(p, here.auto ? '§aAuto shuttle started: the train runs to the next station, waits, then returns.' : '§eAuto shuttle stopped.');
    });
    form.button('Disassemble train');
    actions.push(() => {
      if (disassembleTrain(here, p)) msg(p, '§aTrain disassembled.');
    });
  } else {
    form.body('Build a train on the track next to this station: glue its blocks with Super Glue and include Train Controls (and Seats for passengers).');
    form.button('Assemble train');
    actions.push(() => assembleTrain(b, p));
  }
  form.button('Close');
  form.show(p).then((r) => {
    if (r.canceled || r.selection === undefined) return;
    actions[r.selection]?.();
  }).catch(() => undefined);
}

registerMachine(TRACK, {
  onPlace(b) {
    const p = players().find((pl) => pl.dimension.id === b.dimension.id);
    let pref: Dir | undefined;
    try {
      if (p) pref = dominantHorizontal(p.getViewDirection());
    } catch {
      /* ignore */
    }
    reshapeTrack(b.dimension, b.location, pref);
    for (const d of HORIZONTAL as Dir[]) reshapeTrack(b.dimension, offset(b.location, d));
    reshapeTrack(b.dimension, b.location, pref);
  },
  onBreak(dim, pos) {
    for (const d of HORIZONTAL as Dir[]) reshapeTrack(dimension(dim), offset(pos, d));
  },
});
registerMachine(STATION, { onInteract: (b, p) => (stationMenu(b, p), true) });
registerMachine(SIGNAL, {
  onTick(b) {
    setStates(b, { 'craftoria:red': signalRed(b.dimension, b.location, -1) });
  },
});
registerMachine([SEAT], {
  onInteract(b, p) {
    // sit on a stationary seat
    try {
      const e = b.dimension.spawnEntity(SEAT_ENTITY, { x: b.location.x + 0.5, y: b.location.y + 0.45, z: b.location.z + 0.5 }, { initialRotation: 0 });
      e.setDynamicProperty('cr:seat', dimKey(b.dimension.id, b.location));
      e.getComponent('minecraft:rideable')?.addRider(p);
    } catch (err) {
      logError('seat', err);
    }
    return true;
  },
});

/** Remove empty stationary seat entities. */
export function sweepSeats(): void {
  for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: SEAT_ENTITY })) {
        if (e.getDynamicProperty('cr:seat') === undefined) continue;
        const riders = e.getComponent('minecraft:rideable')?.getRiders() ?? [];
        if (!riders.length) e.remove();
      }
    } catch {
      /* ignore */
    }
  }
}

export { posKey, inGlue, Entity };

/** Test / command hooks */
export function _trains(): Map<number, Train> {
  return trains;
}
export function _assembleTrain(st: Block, p: Player): void {
  assembleTrain(st, p);
}
