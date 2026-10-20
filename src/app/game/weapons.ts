export type WeaponKind = 'projectile' | 'hitscan' | 'beam' | 'melee' | 'wave' | 'chain';

export interface ExplodeDef {
  radius: number;
  damage: number;
  knock: number;
  /** Урон по тайлам (разрушаемость). */
  tileDamage?: number;
}

export interface ProjDef {
  speed: number;
  /** Множитель гравитации (0 — летит прямо). */
  gravity: number;
  /** Коэффициент отскока от стен (0 — взрыв/исчезновение при касании). */
  bounce: number;
  /** Максимум отскоков (для дисков/лазера). */
  maxBounces?: number;
  life: number;
  size: number;
  drag?: number;
  explode?: ExplodeDef;
  /** Взрыв по истечении времени жизни (граната). */
  fuse?: boolean;
  /** Взрыв при попадании в игрока, даже если есть отскок. */
  explodeOnPlayer?: boolean;
  homing?: number;
  /** Делится на суббоеприпасы (кассета/зенитка). */
  split?: { count: number; weapon: number; spread: number; onImpact: boolean };
  /** Прилипает к поверхности (мины, гвозди). */
  stick?: boolean;
  mine?: { arm: number; trigger: number };
  pierce?: boolean;
  /** Гравитационная воронка. */
  vortex?: { radius: number; force: number; duration: number; dps: number };
  /** Пузырь — захватывает цель. */
  bubble?: number;
  /** Заморозка — замедление цели в секундах. */
  freeze?: number;
  /** Бумеранг возвращается к владельцу. */
  boomerang?: boolean;
  /** Бьёт молниями соседей в полёте (БФГ). */
  zap?: { radius: number; dps: number };
}

export interface WeaponDef {
  id: number;
  name: string;
  short: string;
  color: string;
  kind: WeaponKind;
  cooldown: number;
  /** Сколько патронов даёт подбор; -1 — бесконечно. */
  ammo: number;
  maxAmmo: number;
  damage: number;
  pellets?: number;
  spread?: number;
  range?: number;
  knock?: number;
  /** Отдача стрелку (импульс назад). */
  recoil?: number;
  shake?: number;
  /** Пробивает N целей (рельса). */
  pierce?: number;
  /** Отражения луча (рикошет-лазер). */
  reflect?: number;
  /** Цепочка молний (тесла). */
  chain?: { jumps: number; radius: number };
  /** Раскрутка (миниган). */
  spinup?: number;
  /** Замедление цели при попадании. */
  freeze?: number;
  tileDamage?: number;
  proj?: ProjDef;
  sound: SfxName;
  /** Насколько отдаляется камера (снайперка). */
  zoom?: number;
  /** Предпочитаемая дистанция для ботов. */
  botRange: [number, number];
  /** Ценность для выбора ботами. */
  botScore: number;
}

export type SfxName =
  | 'blaster' | 'hammer' | 'mg' | 'shotgun' | 'sshotgun' | 'rocket' | 'grenade' | 'plasma'
  | 'rail' | 'lightning' | 'bfg' | 'nail' | 'minigun' | 'sniper' | 'freeze' | 'laser'
  | 'mine' | 'cluster' | 'homing' | 'vortex' | 'disc' | 'crossbow' | 'tesla' | 'bubble'
  | 'wave' | 'flak' | 'boomerang';

let n = 0;
const W = (d: Omit<WeaponDef, 'id'>): WeaponDef => ({ id: n++, ...d });

export const WEAPONS: WeaponDef[] = [
  W({
    name: 'Бластер', short: 'БЛС', color: '#7fdbff', kind: 'projectile', cooldown: 0.26, ammo: -1, maxAmmo: -1,
    damage: 12, knock: 120, sound: 'blaster', botRange: [0, 700], botScore: 1, tileDamage: 6,
    proj: { speed: 1500, gravity: 0, bounce: 0, life: 1.2, size: 4 },
  }),
  W({
    name: 'Молот', short: 'МЛТ', color: '#ffcc66', kind: 'melee', cooldown: 0.42, ammo: -1, maxAmmo: -1,
    damage: 45, range: 62, knock: 850, shake: 4, sound: 'hammer', botRange: [0, 70], botScore: 2, tileDamage: 45,
  }),
  W({
    name: 'Автомат', short: 'АВТ', color: '#ffe066', kind: 'hitscan', cooldown: 0.09, ammo: 100, maxAmmo: 200,
    damage: 7, spread: 0.045, range: 1600, knock: 45, shake: 1, sound: 'mg', botRange: [0, 900], botScore: 4, tileDamage: 5,
  }),
  W({
    name: 'Дробовик', short: 'ДРБ', color: '#ffa94d', kind: 'hitscan', cooldown: 0.85, ammo: 12, maxAmmo: 30,
    damage: 7, pellets: 10, spread: 0.16, range: 900, knock: 60, recoil: 160, shake: 5, sound: 'shotgun',
    botRange: [0, 350], botScore: 5, tileDamage: 6,
  }),
  W({
    name: 'Двустволка', short: 'ДВС', color: '#ff8c42', kind: 'hitscan', cooldown: 1.2, ammo: 10, maxAmmo: 24,
    damage: 6, pellets: 18, spread: 0.27, range: 700, knock: 70, recoil: 520, shake: 8, sound: 'sshotgun',
    botRange: [0, 260], botScore: 6, tileDamage: 6,
  }),
  W({
    name: 'Ракетомёт', short: 'РКТ', color: '#ff5d5d', kind: 'projectile', cooldown: 0.8, ammo: 10, maxAmmo: 25,
    damage: 0, shake: 3, sound: 'rocket', botRange: [180, 1100], botScore: 9,
    proj: { speed: 950, gravity: 0, bounce: 0, life: 4, size: 6, explode: { radius: 115, damage: 95, knock: 1050, tileDamage: 140 } },
  }),
  W({
    name: 'Гранатомёт', short: 'ГРН', color: '#7bd36b', kind: 'projectile', cooldown: 0.7, ammo: 10, maxAmmo: 25,
    damage: 0, shake: 2, sound: 'grenade', botRange: [150, 650], botScore: 7,
    proj: {
      speed: 780, gravity: 1, bounce: 0.55, life: 2.2, size: 6, fuse: true, explodeOnPlayer: true,
      explode: { radius: 120, damage: 85, knock: 950, tileDamage: 130 },
    },
  }),
  W({
    name: 'Плазмаган', short: 'ПЛЗ', color: '#5ce1ff', kind: 'projectile', cooldown: 0.1, ammo: 60, maxAmmo: 150,
    damage: 0, sound: 'plasma', botRange: [0, 900], botScore: 7,
    proj: { speed: 1350, gravity: 0, bounce: 0, life: 1.8, size: 5, explode: { radius: 32, damage: 15, knock: 160, tileDamage: 12 } },
  }),
  W({
    name: 'Рельсотрон', short: 'РЛС', color: '#33ff99', kind: 'hitscan', cooldown: 1.5, ammo: 10, maxAmmo: 25,
    damage: 85, range: 3500, knock: 450, pierce: 5, shake: 4, sound: 'rail', botRange: [250, 3000], botScore: 9, tileDamage: 60,
  }),
  W({
    name: 'Молния', short: 'МЛН', color: '#a5d8ff', kind: 'beam', cooldown: 0.05, ammo: 100, maxAmmo: 200,
    damage: 4.5, range: 420, knock: 35, sound: 'lightning', botRange: [0, 400], botScore: 8, tileDamage: 3,
  }),
  W({
    name: 'Супер-шар', short: 'БФГ', color: '#7CFC00', kind: 'projectile', cooldown: 2.2, ammo: 3, maxAmmo: 6,
    damage: 0, shake: 6, recoil: 300, sound: 'bfg', botRange: [250, 1500], botScore: 10,
    proj: {
      speed: 520, gravity: 0, bounce: 0, life: 5, size: 16, zap: { radius: 220, dps: 40 },
      explode: { radius: 230, damage: 170, knock: 1400, tileDamage: 250 },
    },
  }),
  W({
    name: 'Гвоздомёт', short: 'ГВЗ', color: '#c0c0c0', kind: 'projectile', cooldown: 0.07, ammo: 100, maxAmmo: 200,
    damage: 9, spread: 0.05, knock: 50, sound: 'nail', botRange: [0, 800], botScore: 6, tileDamage: 4,
    proj: { speed: 1600, gravity: 0.1, bounce: 0, life: 1.5, size: 3, stick: true },
  }),
  W({
    name: 'Миниган', short: 'МИН', color: '#ffd43b', kind: 'hitscan', cooldown: 0.04, ammo: 200, maxAmmo: 400,
    damage: 6, spread: 0.085, range: 1400, knock: 35, recoil: 18, spinup: 0.6, shake: 1, sound: 'minigun',
    botRange: [0, 900], botScore: 8, tileDamage: 5,
  }),
  W({
    name: 'Снайперка', short: 'СНП', color: '#e599f7', kind: 'hitscan', cooldown: 1.7, ammo: 8, maxAmmo: 20,
    damage: 110, range: 4000, knock: 300, shake: 3, zoom: 1.6, sound: 'sniper', botRange: [400, 4000], botScore: 8, tileDamage: 80,
  }),
  W({
    name: 'Морозилка', short: 'МРЗ', color: '#c5f6fa', kind: 'projectile', cooldown: 0.05, ammo: 120, maxAmmo: 240,
    damage: 3, spread: 0.12, knock: 20, sound: 'freeze', botRange: [0, 380], botScore: 6, tileDamage: 2,
    proj: { speed: 720, gravity: -0.05, bounce: 0, life: 0.55, size: 7, drag: 1.6, freeze: 1.4, pierce: true },
  }),
  W({
    name: 'Рикошет-лазер', short: 'ЛЗР', color: '#ff6bcb', kind: 'hitscan', cooldown: 0.5, ammo: 20, maxAmmo: 50,
    damage: 32, range: 2200, knock: 120, reflect: 4, sound: 'laser', botRange: [0, 1600], botScore: 7, tileDamage: 15,
  }),
  W({
    name: 'Мины', short: 'МНЫ', color: '#ff922b', kind: 'projectile', cooldown: 0.6, ammo: 6, maxAmmo: 12,
    damage: 0, sound: 'mine', botRange: [0, 300], botScore: 4,
    proj: {
      speed: 480, gravity: 1, bounce: 0, life: 25, size: 7, stick: true, mine: { arm: 0.7, trigger: 64 },
      explode: { radius: 105, damage: 85, knock: 1000, tileDamage: 120 },
    },
  }),
  W({
    name: 'Кассетник', short: 'КСТ', color: '#ffa8a8', kind: 'projectile', cooldown: 1.1, ammo: 6, maxAmmo: 15,
    damage: 0, sound: 'cluster', botRange: [200, 900], botScore: 8,
    proj: {
      speed: 820, gravity: 0.7, bounce: 0, life: 0.75, size: 8, fuse: true,
      split: { count: 7, weapon: 27, spread: 1.6, onImpact: true },
      explode: { radius: 50, damage: 20, knock: 300, tileDamage: 40 },
    },
  }),
  W({
    name: 'Самонаводка', short: 'СМН', color: '#ff4d6d', kind: 'projectile', cooldown: 1.0, ammo: 8, maxAmmo: 20,
    damage: 0, shake: 2, sound: 'homing', botRange: [200, 1400], botScore: 9,
    proj: { speed: 620, gravity: 0, bounce: 0, life: 5, size: 6, homing: 4.2, explode: { radius: 90, damage: 70, knock: 800, tileDamage: 100 } },
  }),
  W({
    name: 'Гравитон', short: 'ГРВ', color: '#9775fa', kind: 'projectile', cooldown: 1.6, ammo: 4, maxAmmo: 8,
    damage: 0, sound: 'vortex', botRange: [200, 800], botScore: 7,
    proj: {
      speed: 720, gravity: 0.8, bounce: 0.4, life: 1.1, size: 8, fuse: true,
      vortex: { radius: 280, force: 2600, duration: 2.2, dps: 22 },
      explode: { radius: 130, damage: 60, knock: 1300, tileDamage: 100 },
    },
  }),
  W({
    name: 'Дискомёт', short: 'ДСК', color: '#66d9e8', kind: 'projectile', cooldown: 0.6, ammo: 15, maxAmmo: 35,
    damage: 38, knock: 380, sound: 'disc', botRange: [0, 1200], botScore: 7, tileDamage: 20,
    proj: { speed: 1150, gravity: 0, bounce: 1, maxBounces: 6, life: 2.6, size: 9, pierce: true },
  }),
  W({
    name: 'Арбалет', short: 'АРБ', color: '#d9a066', kind: 'projectile', cooldown: 0.9, ammo: 12, maxAmmo: 30,
    damage: 65, knock: 650, sound: 'crossbow', botRange: [200, 2000], botScore: 7, tileDamage: 30,
    proj: { speed: 1900, gravity: 0.25, bounce: 0, life: 3, size: 4, stick: true },
  }),
  W({
    name: 'Тесла', short: 'ТСЛ', color: '#74c0fc', kind: 'chain', cooldown: 0.35, ammo: 30, maxAmmo: 60,
    damage: 18, range: 360, knock: 150, chain: { jumps: 3, radius: 220 }, sound: 'tesla', botRange: [0, 360], botScore: 7,
  }),
  W({
    name: 'Пузырятор', short: 'ПЗР', color: '#99e9f2', kind: 'projectile', cooldown: 0.9, ammo: 10, maxAmmo: 20,
    damage: 10, sound: 'bubble', botRange: [0, 700], botScore: 5,
    proj: { speed: 520, gravity: -0.08, bounce: 0.8, maxBounces: 3, life: 3, size: 14, bubble: 1.8, explodeOnPlayer: true },
  }),
  W({
    name: 'Ударная волна', short: 'ВЛН', color: '#ffffff', kind: 'wave', cooldown: 1.0, ammo: 10, maxAmmo: 20,
    damage: 22, range: 250, knock: 1500, recoil: 250, shake: 6, sound: 'wave', botRange: [0, 220], botScore: 6, tileDamage: 30,
  }),
  W({
    name: 'Зенитка', short: 'ЗНТ', color: '#fab005', kind: 'projectile', cooldown: 0.8, ammo: 10, maxAmmo: 24,
    damage: 15, sound: 'flak', botRange: [100, 900], botScore: 7,
    proj: {
      speed: 1250, gravity: 0.3, bounce: 0, life: 0.45, size: 6, fuse: true,
      split: { count: 9, weapon: 28, spread: 6.28, onImpact: true },
    },
  }),
  W({
    name: 'Бумеранг', short: 'БМР', color: '#69db7c', kind: 'projectile', cooldown: 0.75, ammo: 12, maxAmmo: 25,
    damage: 34, knock: 300, sound: 'boomerang', botRange: [0, 700], botScore: 6, tileDamage: 10,
    proj: { speed: 1000, gravity: 0, bounce: 0.6, maxBounces: 3, life: 2.4, size: 9, boomerang: true, pierce: true },
  }),
  // --- Служебные суббоеприпасы (не выдаются игрокам) ---
  W({
    name: 'Бомбочка', short: '', color: '#ffa8a8', kind: 'projectile', cooldown: 0, ammo: 0, maxAmmo: 0,
    damage: 0, sound: 'cluster', botRange: [0, 0], botScore: 0,
    proj: {
      speed: 0, gravity: 1, bounce: 0.45, life: 0.9, size: 4, fuse: true, explodeOnPlayer: true,
      explode: { radius: 58, damage: 28, knock: 420, tileDamage: 60 },
    },
  }),
  W({
    name: 'Осколок', short: '', color: '#ffd43b', kind: 'projectile', cooldown: 0, ammo: 0, maxAmmo: 0,
    damage: 11, knock: 90, sound: 'flak', botRange: [0, 0], botScore: 0, tileDamage: 6,
    proj: { speed: 0, gravity: 0.4, bounce: 0, life: 0.5, size: 3 },
  }),
];

/** Оружие, которое реально можно подобрать (без служебных). */
export const PLAYABLE_WEAPONS = WEAPONS.filter((w) => w.ammo !== 0);
export const WEAPON_COUNT = PLAYABLE_WEAPONS.length;
/** Стартовые: бластер и молот. */
export const DEFAULT_WEAPONS = [0, 1];
/** Пул для точек появления оружия. */
export const SPAWN_POOL = PLAYABLE_WEAPONS.filter((w) => !DEFAULT_WEAPONS.includes(w.id)).map((w) => w.id);

export type PowerKind = 'quad' | 'haste' | 'shield' | 'jet' | 'regen';
export const POWERS: { kind: PowerKind; name: string; color: string; duration: number }[] = [
  { kind: 'quad', name: 'Тройной урон', color: '#9b6bff', duration: 18 },
  { kind: 'haste', name: 'Ускорение', color: '#ffd43b', duration: 20 },
  { kind: 'shield', name: 'Силовой щит', color: '#4dabf7', duration: 20 },
  { kind: 'jet', name: 'Реактивный ранец', color: '#ff922b', duration: 18 },
  { kind: 'regen', name: 'Регенерация', color: '#51cf66', duration: 20 },
];
