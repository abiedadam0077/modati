// Minimal simulated @minecraft/server used by the integration tests.
// Block types/states/custom components are loaded from the GENERATED behavior pack
// (build/CRAFTORIA_BP/blocks/*.json) so tests exercise the real content definitions.
import fs from 'node:fs';
import path from 'node:path';

type Vec = { x: number; y: number; z: number };
type StateVal = string | number | boolean;

// ------------------------------------------------------------------ enums
export enum Direction { Down = 'Down', Up = 'Up', North = 'North', South = 'South', West = 'West', East = 'East' }
export enum GameMode { Adventure = 'Adventure', Creative = 'Creative', Spectator = 'Spectator', Survival = 'Survival' }
export enum EquipmentSlot { Chest = 'Chest', Feet = 'Feet', Head = 'Head', Legs = 'Legs', Mainhand = 'Mainhand', Offhand = 'Offhand' }
export enum EntityDamageCause { contact = 'contact', entityAttack = 'entityAttack' }
export enum CommandPermissionLevel { Any = 0, GameDirectors = 1, Admin = 2, Host = 3, Owner = 4 }
export enum CustomCommandParamType { Enum = 'Enum', Integer = 'Integer', String = 'String' }
export enum CustomCommandStatus { Success = 0, Failure = 1 }

export class MolangVariableMap {
  setColorRGBA(): void {}
}
export class EnchantmentType {
  constructor(public id: string) {}
}

// ------------------------------------------------------------------ block definitions
interface BlockDef {
  states: Record<string, StateVal[]>;
  custom: string[];
  tick?: number;
}
const defs = new Map<string, BlockDef>();
function loadDefs(): void {
  const dir = path.resolve(process.cwd(), 'build/CRAFTORIA_BP/blocks');
  if (!fs.existsSync(dir)) throw new Error('mock: run `node tools/build.mjs` first (needs build/CRAFTORIA_BP/blocks)');
  for (const f of fs.readdirSync(dir)) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))['minecraft:block'];
    const states: Record<string, StateVal[]> = {};
    for (const [k, v] of Object.entries(j.description.states ?? {})) {
      if (Array.isArray(v)) states[k] = v as StateVal[];
      else {
        const r = (v as { values: { min: number; max: number } }).values;
        const arr: number[] = [];
        for (let i = r.min; i <= r.max; i++) arr.push(i);
        states[k] = arr;
      }
    }
    const comps = j.components ?? {};
    const custom = Object.keys(comps).filter((k) => !k.startsWith('minecraft:'));
    const tick = comps['minecraft:tick']?.interval_range?.[0];
    defs.set(j.description.identifier, { states, custom, tick });
  }
}
loadDefs();

const VANILLA_STATES: Record<string, Record<string, StateVal>> = {
  'minecraft:water': { liquid_depth: 0 },
  'minecraft:flowing_water': { liquid_depth: 1 },
  'minecraft:campfire': { extinguished: false },
  'minecraft:wheat': { growth: 0 },
};

export class BlockType {
  constructor(public id: string) {}
}

export class BlockPermutation {
  readonly type: BlockType;
  private constructor(typeId: string, private states: Record<string, StateVal>) {
    this.type = new BlockType(typeId);
  }
  static resolve(typeId: string, states?: Record<string, StateVal>): BlockPermutation {
    const d = defs.get(typeId);
    const base: Record<string, StateVal> = {};
    if (d) for (const [k, v] of Object.entries(d.states)) base[k] = v[0];
    else if (VANILLA_STATES[typeId]) Object.assign(base, VANILLA_STATES[typeId]);
    else if (!typeId.startsWith('minecraft:')) throw new Error(`unknown block ${typeId}`);
    return new BlockPermutation(typeId, { ...base, ...(states ?? {}) });
  }
  getState(name: string): StateVal | undefined {
    return this.states[name];
  }
  getAllStates(): Record<string, StateVal> {
    return { ...this.states };
  }
  withState(name: string, value: StateVal): BlockPermutation {
    if (!(name in this.states)) throw new Error(`state ${name} not on ${this.type.id}`);
    const d = defs.get(this.type.id);
    if (d && d.states[name] && !d.states[name].includes(value)) throw new Error(`invalid value ${String(value)} for ${name}`);
    return new BlockPermutation(this.type.id, { ...this.states, [name]: value });
  }
}

// ------------------------------------------------------------------ items
const MAX_STACK: Record<string, number> = { 'minecraft:water_bucket': 1, 'minecraft:lava_bucket': 1, 'minecraft:bucket': 16, 'craftoria:wrench': 1 };
export class ItemStack {
  amount: number;
  nameTag?: string;
  private lore: string[] = [];
  private dp = new Map<string, StateVal>();
  constructor(public readonly typeId: string, amount = 1) {
    if (!typeId.includes(':')) this.typeId = `minecraft:${typeId}`;
    this.amount = amount;
  }
  get maxAmount(): number {
    return MAX_STACK[this.typeId] ?? 64;
  }
  get isStackable(): boolean {
    return this.maxAmount > 1;
  }
  clone(): ItemStack {
    const c = new ItemStack(this.typeId, this.amount);
    c.nameTag = this.nameTag;
    c.lore = [...this.lore];
    return c;
  }
  getLore(): string[] {
    return [...this.lore];
  }
  setLore(l?: string[]): void {
    this.lore = l ? [...l] : [];
  }
  getComponent(): undefined {
    return undefined;
  }
  getDynamicPropertyIds(): string[] {
    return [...this.dp.keys()];
  }
  getDynamicProperty(k: string): StateVal | undefined {
    return this.dp.get(k);
  }
  setDynamicProperty(k: string, v?: StateVal): void {
    if (v === undefined) this.dp.delete(k);
    else this.dp.set(k, v);
  }
  hasTag(tag: string): boolean {
    if (tag === 'minecraft:planks') return this.typeId.endsWith('_planks');
    return false;
  }
  isStackableWith(o: ItemStack): boolean {
    return o.typeId === this.typeId;
  }
}

export class Container {
  private slots: (ItemStack | undefined)[];
  constructor(public readonly size: number) {
    this.slots = new Array(size).fill(undefined);
  }
  get isValid(): boolean {
    return true;
  }
  get emptySlotsCount(): number {
    return this.slots.filter((s) => !s).length;
  }
  getItem(i: number): ItemStack | undefined {
    const s = this.slots[i];
    return s ? s.clone() : undefined;
  }
  setItem(i: number, it?: ItemStack): void {
    this.slots[i] = it ? it.clone() : undefined;
  }
  addItem(it: ItemStack): ItemStack | undefined {
    let left = it.amount;
    for (let i = 0; i < this.size && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.typeId === it.typeId && s.amount < s.maxAmount) {
        const t = Math.min(left, s.maxAmount - s.amount);
        s.amount += t;
        left -= t;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const t = Math.min(left, it.maxAmount);
        this.slots[i] = new ItemStack(it.typeId, t);
        left -= t;
      }
    }
    return left > 0 ? new ItemStack(it.typeId, left) : undefined;
  }
  /** test helper */
  count(typeId: string): number {
    return this.slots.reduce((a, s) => a + (s && s.typeId === typeId ? s.amount : 0), 0);
  }
}

// ------------------------------------------------------------------ world storage
const key = (p: Vec) => `${p.x},${p.y},${p.z}`;
const CONTAINERS = new Set(['minecraft:chest', 'minecraft:barrel', 'minecraft:hopper']);

interface Cell {
  perm: BlockPermutation;
  container?: Container;
  power?: number;
}

export class Block {
  constructor(public readonly dimension: Dimension, public readonly location: Vec) {}
  private get cell(): Cell | undefined {
    return this.dimension._cells.get(key(this.location));
  }
  get isValid(): boolean {
    return true;
  }
  get typeId(): string {
    return this.cell?.perm.type.id ?? 'minecraft:air';
  }
  get permutation(): BlockPermutation {
    return this.cell?.perm ?? BlockPermutation.resolve('minecraft:air');
  }
  get isAir(): boolean {
    return this.typeId === 'minecraft:air';
  }
  get isLiquid(): boolean {
    return /water|lava/.test(this.typeId);
  }
  get isWaterlogged(): boolean {
    return false;
  }
  center(): Vec {
    return { x: this.location.x + 0.5, y: this.location.y + 0.5, z: this.location.z + 0.5 };
  }
  bottomCenter(): Vec {
    return { x: this.location.x + 0.5, y: this.location.y, z: this.location.z + 0.5 };
  }
  setPermutation(p: BlockPermutation): void {
    this.dimension._setPerm(this.location, p, false);
  }
  setType(t: string): void {
    this.dimension.setBlockType(this.location, t);
  }
  getRedstonePower(): number | undefined {
    return this.cell?.power ?? 0;
  }
  getComponent(id: string): { container?: Container } | undefined {
    if (id === 'minecraft:inventory' && this.cell?.container) return { container: this.cell.container };
    return undefined;
  }
}

let nextEntityId = 1;
const entities = new Map<string, Entity>();

export class Entity {
  readonly id: string;
  isValid = true;
  isSneaking = false;
  location: Vec;
  private props = new Map<string, StateVal>();
  private dprops = new Map<string, StateVal>();
  readonly commands: string[] = [];
  readonly animations: string[] = [];
  itemStack?: ItemStack;
  health = 20;
  constructor(public readonly typeId: string, public dimension: Dimension, loc: Vec) {
    this.id = String(nextEntityId++);
    this.location = { ...loc };
    entities.set(this.id, this);
  }
  getProperty(k: string): StateVal | undefined {
    return this.props.get(k);
  }
  setProperty(k: string, v: StateVal): void {
    this.props.set(k, v);
  }
  getDynamicProperty(k: string): StateVal | undefined {
    return this.dprops.get(k);
  }
  setDynamicProperty(k: string, v?: StateVal): void {
    if (v === undefined) this.dprops.delete(k);
    else this.dprops.set(k, v);
  }
  teleport(loc: Vec): void {
    this.location = { ...loc };
  }
  remove(): void {
    this.isValid = false;
    entities.delete(this.id);
  }
  runCommand(cmd: string): { successCount: number } {
    this.commands.push(cmd);
    return { successCount: 1 };
  }
  playAnimation(name: string): void {
    this.animations.push(name);
  }
  getComponent(id: string): unknown {
    if (id === 'minecraft:item' && this.itemStack) return { itemStack: this.itemStack.clone() };
    if (id === 'minecraft:rideable') return { getRiders: () => [], addRider: () => true };
    return undefined;
  }
  applyImpulse(): void {}
  applyKnockback(): void {}
  clearVelocity(): void {}
  applyDamage(n: number): boolean {
    this.health -= n;
    return true;
  }
  getViewDirection(): Vec {
    return { x: 0, y: 0, z: -1 };
  }
}

export class Player extends Entity {
  name = 'Tester';
  selectedSlotIndex = 0;
  playerPermissionLevel = 2;
  readonly inventory = new Container(36);
  readonly messages: string[] = [];
  gameMode = GameMode.Survival;
  readonly onScreenDisplay = { setActionBar: (t: string) => this.messages.push(`[bar] ${t}`) };
  readonly inputInfo = { getMovementVector: () => ({ x: 0, y: 0 }) };
  constructor(dim: Dimension, loc: Vec) {
    super('minecraft:player', dim, loc);
  }
  sendMessage(m: string): void {
    this.messages.push(m);
  }
  getGameMode(): GameMode {
    return this.gameMode;
  }
  override getComponent(id: string): unknown {
    if (id === 'minecraft:inventory') return { container: this.inventory };
    if (id === 'minecraft:equippable') return { getEquipment: (s: EquipmentSlot) => (s === EquipmentSlot.Mainhand ? this.inventory.getItem(this.selectedSlotIndex) : undefined) };
    return undefined;
  }
  addExperience(): number {
    return 0;
  }
  getBlockFromViewDirection(): undefined {
    return undefined;
  }
}

export class Dimension {
  readonly _cells = new Map<string, Cell>();
  readonly sounds: string[] = [];
  constructor(public readonly id: string) {}
  getBlock(p: Vec): Block | undefined {
    if (p.y < -64 || p.y > 319) return undefined;
    return new Block(this, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
  }
  isChunkLoaded(): boolean {
    return true;
  }
  _setPerm(p: Vec, perm: BlockPermutation, fireEvents: boolean): void {
    const k = key(p);
    const old = this._cells.get(k);
    if (perm.type.id === 'minecraft:air') this._cells.delete(k);
    else {
      const cell: Cell = { perm, container: old && old.perm.type.id === perm.type.id ? old.container : CONTAINERS.has(perm.type.id) ? new Container(perm.type.id === 'minecraft:hopper' ? 5 : 27) : undefined };
      this._cells.set(k, cell);
    }
    if (!fireEvents) return;
    if (old && old.perm.type.id !== perm.type.id) fireBlock('onBreak', this, p, old.perm);
    if (perm.type.id !== 'minecraft:air' && (!old || old.perm.type.id !== perm.type.id)) fireBlock('onPlace', this, p);
  }
  setBlockType(p: Vec, typeId: string): void {
    this._setPerm(p, BlockPermutation.resolve(typeId), true);
  }
  setBlockPermutation(p: Vec, perm: BlockPermutation): void {
    this._setPerm(p, perm, true);
  }
  spawnEntity(typeId: string, loc: Vec): Entity {
    return new Entity(typeId, this, loc);
  }
  spawnItem(it: ItemStack, loc: Vec): Entity {
    const e = new Entity('minecraft:item', this, loc);
    e.itemStack = it.clone();
    return e;
  }
  getEntities(q: { type?: string; location?: Vec; maxDistance?: number } = {}): Entity[] {
    const out: Entity[] = [];
    for (const e of entities.values()) {
      if (e.dimension !== this || !e.isValid) continue;
      if (q.type && e.typeId !== q.type) continue;
      if (q.location && q.maxDistance !== undefined) {
        const dx = e.location.x - q.location.x, dy = e.location.y - q.location.y, dz = e.location.z - q.location.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > q.maxDistance) continue;
      }
      out.push(e);
    }
    return out;
  }
  playSound(id: string): void {
    this.sounds.push(id);
  }
  spawnParticle(): void {}
  runCommand(cmd: string): { successCount: number } {
    const m = /^setblock (-?\d+) (-?\d+) (-?\d+) air destroy$/.exec(cmd);
    if (m) {
      const p = { x: +m[1], y: +m[2], z: +m[3] };
      const b = this.getBlock(p)!;
      const id = b.typeId;
      if (id === 'minecraft:air') return { successCount: 0 };
      this.setBlockType(p, 'minecraft:air');
      const drop = id === 'minecraft:stone' ? 'minecraft:cobblestone' : id;
      this.spawnItem(new ItemStack(drop, 1), { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
      return { successCount: 1 };
    }
    return { successCount: 0 };
  }
  /** test helper: place without firing events */
  put(p: Vec, typeId: string, states: Record<string, StateVal> = {}): Block {
    this._setPerm(p, BlockPermutation.resolve(typeId, states), true);
    return this.getBlock(p)!;
  }
  setPower(p: Vec, power: number): void {
    const c = this._cells.get(key(p));
    if (c) c.power = power;
  }
}

// ------------------------------------------------------------------ events
type Handler = (...a: unknown[]) => void;
class Signal {
  private hs: Handler[] = [];
  subscribe<T extends Handler>(h: T): T {
    this.hs.push(h);
    return h;
  }
  unsubscribe(h: Handler): void {
    this.hs = this.hs.filter((x) => x !== h);
  }
  fire(...a: unknown[]): void {
    for (const h of this.hs) h(...a);
  }
}

const dims = new Map<string, Dimension>();
const dynProps = new Map<string, StateVal>();
const players: Player[] = [];

export const world = {
  getDimension(id: string): Dimension {
    let d = dims.get(id);
    if (!d) dims.set(id, (d = new Dimension(id)));
    return d;
  },
  getEntity(id: string): Entity | undefined {
    return entities.get(id);
  },
  getAllPlayers(): Player[] {
    return players;
  },
  getDynamicProperty(k: string): StateVal | undefined {
    return dynProps.get(k);
  },
  setDynamicProperty(k: string, v?: StateVal): void {
    if (v === undefined) dynProps.delete(k);
    else dynProps.set(k, v);
  },
  getDynamicPropertyIds(): string[] {
    return [...dynProps.keys()];
  },
  afterEvents: {
    entityLoad: new Signal(), worldLoad: new Signal(), playerPlaceBlock: new Signal(), playerBreakBlock: new Signal(), itemUse: new Signal(),
  },
  beforeEvents: { playerInteractWithBlock: new Signal(), itemUse: new Signal() },
};

// custom component registries
const blockComponents = new Map<string, Record<string, Handler>>();
const itemComponents = new Map<string, Record<string, Handler>>();
export class BlockComponentRegistry {
  registerCustomComponent(name: string, c: Record<string, Handler>): void {
    blockComponents.set(name, c);
  }
}
export class ItemComponentRegistry {
  registerCustomComponent(name: string, c: Record<string, Handler>): void {
    itemComponents.set(name, c);
  }
}
export class CustomCommandRegistry {
  registerCommand(): void {}
  registerEnum(): void {}
}

function fireBlock(ev: string, dim: Dimension, p: Vec, perm?: BlockPermutation): void {
  const typeId = perm ? perm.type.id : dim.getBlock(p)!.typeId;
  const d = defs.get(typeId);
  if (!d) return;
  for (const c of d.custom) {
    const h = blockComponents.get(c)?.[ev];
    if (!h) continue;
    const block = dim.getBlock(p)!;
    h({ block, dimension: dim, brokenBlockPermutation: perm }, { params: {} });
  }
}

/** Simulate a player using a block (custom component onPlayerInteract). */
export function interact(player: Player, b: Block, face = Direction.Up): void {
  const d = defs.get(b.typeId);
  for (const c of d?.custom ?? []) blockComponents.get(c)?.onPlayerInteract?.({ block: b, player, face, dimension: b.dimension }, { params: {} });
}

let tick = 0;
const intervals: { fn: () => void; every: number; next: number }[] = [];
const timeouts: { fn: () => void; at: number }[] = [];
export const system = {
  get currentTick(): number {
    return tick;
  },
  runInterval(fn: () => void, every = 1): number {
    intervals.push({ fn, every, next: tick + every });
    return intervals.length;
  },
  runTimeout(fn: () => void, delay = 1): number {
    timeouts.push({ fn, at: tick + delay });
    return timeouts.length;
  },
  run(fn: () => void): number {
    timeouts.push({ fn, at: tick + 1 });
    return timeouts.length;
  },
  runJob(gen: Generator): number {
    for (const _ of gen) {
      /* drain */
    }
    return 0;
  },
  clearRun(): void {},
  beforeEvents: { startup: new Signal() },
};

/** Advance the simulation by n ticks (block ticks, intervals, timeouts). */
export function advance(n = 1): void {
  for (let i = 0; i < n; i++) {
    tick++;
    for (const t of timeouts.filter((x) => x.at <= tick)) {
      timeouts.splice(timeouts.indexOf(t), 1);
      t.fn();
    }
    for (const iv of intervals) if (tick >= iv.next) {
      iv.next = tick + iv.every;
      iv.fn();
    }
    // block ticks
    for (const d of dims.values()) {
      for (const [k, c] of [...d._cells]) {
        const def = defs.get(c.perm.type.id);
        if (!def?.tick || tick % def.tick !== 0) continue;
        const [x, y, z] = k.split(',').map(Number);
        fireBlock('onTick', d, { x, y, z });
      }
    }
  }
}

export function boot(): void {
  system.beforeEvents.startup.fire({ blockComponentRegistry: new BlockComponentRegistry(), itemComponentRegistry: new ItemComponentRegistry(), customCommandRegistry: new CustomCommandRegistry() });
  world.afterEvents.worldLoad.fire({});
}

export function addPlayer(dim: Dimension, loc: Vec): Player {
  const p = new Player(dim, loc);
  players.push(p);
  return p;
}

export function allEntities(): Entity[] {
  return [...entities.values()];
}

export type Vector3 = Vec;
export type Vector2 = { x: number; y: number };
