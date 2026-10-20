/** Размер тайла карты в пикселях мира. */
export const TILE = 32;

/** Фиксированный шаг симуляции. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Частота рассылки снапшотов хостом. */
export const SNAPSHOT_RATE = 30;

/** Физика игрока. Подобрано под динамику «как в Quake»: быстрый бег, высокий прыжок, контроль в воздухе. */
export const PHYS = {
  gravity: 2100,
  maxFall: 1500,
  runSpeed: 380,
  groundAccel: 4200,
  groundFriction: 3200,
  airAccel: 1500,
  /** В воздухе можно разогнаться выше runSpeed только за счёт взрывов/джамп-падов. */
  airMaxSpeed: 380,
  airDrag: 0.15,
  jumpVel: 780,
  doubleJumpVel: 680,
  wallJumpVelX: 430,
  wallJumpVelY: 700,
  wallSlideMax: 260,
  /** Время «койота» — можно прыгнуть сразу после схода с края. */
  coyoteTime: 0.09,
  jumpBuffer: 0.12,
  playerW: 22,
  playerH: 40,
  maxHealth: 100,
  overHealth: 200,
  maxArmor: 150,
  respawnTime: 2.0,
  spawnShield: 1.6,
  jumpPadVel: 1350,
} as const;

export const COLORS = [
  '#4fc3f7', '#ff8a65', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac',
  '#f06292', '#90a4ae', '#7986cb', '#e57373', '#81c784', '#ffb74d',
];

export const TEAM_COLORS = ['#ff6b6b', '#4dabf7'];

export const BOT_NAMES = [
  'Болтик', 'Шестерёнка', 'Пиксель', 'Чип', 'Робо-Кот', 'Винтик', 'Турбо',
  'Ракетка', 'Байт', 'Лазерчик', 'Гаечка', 'Нейрон', 'Зум', 'Квант', 'Искра', 'Кубик',
];
