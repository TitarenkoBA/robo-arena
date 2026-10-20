import { PHYS } from './constants';
import { ItemKind, PropKind } from './maps';
import { DEFAULT_WEAPONS, PowerKind, WEAPONS } from './weapons';

export interface Input {
  seq: number;
  /** Горизонтальное движение -1..1. */
  mx: number;
  jump: boolean;
  down: boolean;
  fire: boolean;
  /** Угол прицела в радианах. */
  aim: number;
  /** Желаемое оружие (id). */
  w: number;
}

export const emptyInput = (): Input => ({ seq: 0, mx: 0, jump: false, down: false, fire: false, aim: 0, w: 0 });

export type GameMode = 'ffa' | 'tdm';

export interface GameSettings {
  mapId: string;
  mode: GameMode;
  fragLimit: number;
  /** Минуты. */
  timeLimit: number;
  bots: number;
  botSkill: number;
  friendlyFire: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mapId: 'factory',
  mode: 'ffa',
  fragLimit: 20,
  timeLimit: 10,
  bots: 3,
  botSkill: 3,
  friendlyFire: false,
};

export type PowerTimers = Record<PowerKind, number>;
const noPowers = (): PowerTimers => ({ quad: 0, haste: 0, shield: 0, jet: 0, regen: 0 });

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  readonly w = PHYS.playerW;
  readonly h = PHYS.playerH;
  aim = 0;
  hp: number = PHYS.maxHealth;
  armor = 0;
  alive = false;
  respawn = 0.5;
  weapon = 0;
  /** Битовая маска имеющегося оружия. */
  owned = 0;
  ammo: number[] = WEAPONS.map(() => 0);
  cooldown = 0;
  spin = 0;
  frags = 0;
  deaths = 0;
  streak = 0;
  // --- Состояние движения (синхронизируется для предсказания) ---
  onGround = false;
  coyote = 0;
  jumpBuffer = 0;
  jumpHeld = false;
  jumpRising = false;
  airJumps = 0;
  wallDir = 0;
  dropTimer = 0;
  teleCd = 0;
  // --- Эффекты ---
  slow = 0;
  bubble = 0;
  spawnShield = 0;
  powers: PowerTimers = noPowers();
  lastHitBy = -1;
  lastHitTime = 0;
  // --- Сеть ---
  input: Input = emptyInput();
  inputQueue: Input[] = [];
  lastAck = 0;
  lastReqW = -1;
  ping = 0;
  // --- Только отрисовка ---
  rx = 0;
  ry = 0;
  ox = 0;
  oy = 0;
  runPhase = 0;
  hurt = 0;
  facing = 1;
  muzzle = 0;

  constructor(
    public id: number,
    public name: string,
    public color: string,
    public team: number,
    public isBot: boolean,
  ) {
    this.resetLoadout();
  }

  resetLoadout() {
    this.owned = 0;
    this.ammo = WEAPONS.map(() => 0);
    for (const id of DEFAULT_WEAPONS) {
      this.owned |= 1 << id;
      this.ammo[id] = -1;
    }
    this.weapon = 0;
    this.hp = PHYS.maxHealth;
    this.armor = 0;
    this.powers = noPowers();
    this.slow = 0;
    this.bubble = 0;
    this.spin = 0;
  }

  has(w: number) { return (this.owned & (1 << w)) !== 0; }
}

export interface Projectile {
  id: number;
  wid: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  bounces: number;
  stuck: boolean;
  /** Урон с учётом усилителей на момент выстрела. */
  mult: number;
  hit: number[];
  /** Для воронки: время активной фазы. */
  active: number;
  // отрисовка: позиция для рендера и позиция на прошлом тике
  rx: number;
  ry: number;
  ox: number;
  oy: number;
}

export interface Prop {
  id: number;
  /** Индекс точки появления на карте (для возрождения). */
  home: number;
  kind: PropKind;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  mass: number;
  onGround: boolean;
  lastHitBy: number;
  // отрисовка
  rx: number;
  ry: number;
  ox: number;
  oy: number;
}

export const PROP_INFO: Record<PropKind, { w: number; h: number; hp: number; mass: number; color: string; edge: string }> = {
  crate: { w: 30, h: 30, hp: 45, mass: 1.2, color: '#a87b4a', edge: '#d6a46a' },
  metal: { w: 30, h: 30, hp: 160, mass: 3, color: '#6c7a8f', edge: '#a4b2c6' },
  barrel: { w: 24, h: 32, hp: 22, mass: 1.5, color: '#e8590c', edge: '#ffa94d' },
};

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  active: boolean;
  timer: number;
  /** Для оружия — id оружия; для усилителя — индекс в POWERS. */
  sub: number;
}

export const ITEM_RESPAWN: Record<ItemKind, number> = {
  health: 15,
  mega: 35,
  armor: 20,
  armorBig: 30,
  ammo: 18,
  weapon: 12,
  power: 45,
};

export type JumpKind = 'j' | 'dj' | 'wj' | 'pad' | 'tele';

export type GameEvent =
  | { k: 'shot'; p: number; w: number; x: number; y: number; a: number }
  | { k: 'trace'; w: number; pts: number[] }
  | { k: 'beam'; p: number; w: number; x: number; y: number; x2: number; y2: number }
  | { k: 'chain'; pts: number[] }
  | { k: 'boom'; x: number; y: number; r: number; w: number }
  | { k: 'hit'; p: number; x: number; y: number; d: number }
  | { k: 'wall'; x: number; y: number; c: string }
  | { k: 'tile'; i: number; v: number; t: number }
  | { k: 'crack'; i: number; l: number }
  | { k: 'pop'; p: number; x: number; y: number; c: string }
  | { k: 'kill'; a: number; v: number; w: number }
  | { k: 'spawn'; p: number; x: number; y: number }
  | { k: 'item'; i: number; on: boolean; sub: number }
  | { k: 'pick'; p: number; kind: ItemKind; sub: number; x: number; y: number }
  | { k: 'jump'; p: number; x: number; y: number; t: JumpKind }
  | { k: 'prop'; id: number; x: number; y: number; kind: PropKind }
  | { k: 'vortex'; x: number; y: number; r: number; d: number }
  | { k: 'msg'; text: string }
  | { k: 'end'; winner: string };

export interface RosterEntry {
  id: number;
  name: string;
  color: string;
  team: number;
  frags: number;
  deaths: number;
  bot: boolean;
  ping: number;
}
