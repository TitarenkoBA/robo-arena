import { TILE } from './constants';

export enum T {
  EMPTY = 0,
  METAL = 1,
  BRICK = 2,
  WOOD = 3,
  GLASS = 4,
  PLATFORM = 5,
  JUMPPAD = 6,
  TELE = 7,
  STONE = 8,
}

export interface TileInfo {
  solid: boolean;
  oneWay?: boolean;
  /** HP разрушаемого тайла; 0 — неразрушаемый. */
  hp: number;
  color: string;
  edge: string;
  debris: string;
}

export const TILE_INFO: Record<number, TileInfo> = {
  [T.EMPTY]: { solid: false, hp: 0, color: 'transparent', edge: '', debris: '' },
  [T.METAL]: { solid: true, hp: 0, color: '#3a4459', edge: '#59657f', debris: '#8b97b0' },
  [T.BRICK]: { solid: true, hp: 140, color: '#a0563c', edge: '#c47552', debris: '#d88a63' },
  [T.WOOD]: { solid: true, hp: 55, color: '#8d6438', edge: '#b58450', debris: '#d6a46a' },
  [T.GLASS]: { solid: true, hp: 14, color: 'rgba(150,220,255,0.35)', edge: 'rgba(210,245,255,0.8)', debris: '#bfefff' },
  [T.PLATFORM]: { solid: false, oneWay: true, hp: 0, color: '#6b7a99', edge: '#9fb0d0', debris: '#9fb0d0' },
  [T.JUMPPAD]: { solid: false, oneWay: true, hp: 0, color: '#36e0a0', edge: '#9dffd8', debris: '' },
  [T.TELE]: { solid: false, hp: 0, color: '#b16cff', edge: '#e4c8ff', debris: '' },
  [T.STONE]: { solid: true, hp: 260, color: '#5f6a73', edge: '#7e8a94', debris: '#a2adb6' },
};

export interface RayHit {
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** Нормаль поверхности. */
  nx: number;
  ny: number;
  t: number;
  tile: number;
}

export class TileMap {
  readonly t: Uint8Array;
  readonly hp: Float32Array;
  /** Уровень трещин 0..3 — чисто визуальный, синхронизируется событиями. */
  readonly crack: Uint8Array;
  /** Пары телепортов: индекс тайла → индекс тайла-выхода. */
  readonly tele = new Map<number, number>();
  /** Счётчик изменений — для перестройки навигации ботов и кэша отрисовки. */
  version = 0;

  constructor(readonly w: number, readonly h: number, tiles?: Uint8Array) {
    this.t = tiles ? new Uint8Array(tiles) : new Uint8Array(w * h);
    this.hp = new Float32Array(w * h);
    this.crack = new Uint8Array(w * h);
    for (let i = 0; i < this.t.length; i++) this.hp[i] = TILE_INFO[this.t[i]].hp;
  }

  get pxW() { return this.w * TILE; }
  get pxH() { return this.h * TILE; }

  idx(cx: number, cy: number) { return cy * this.w + cx; }

  get(cx: number, cy: number): number {
    if (cx < 0 || cx >= this.w || cy < 0) return T.METAL;
    if (cy >= this.h) return T.EMPTY; // снизу — пропасть
    return this.t[cy * this.w + cx];
  }

  isSolid(cx: number, cy: number) { return TILE_INFO[this.get(cx, cy)].solid; }

  isSolidPx(px: number, py: number) {
    return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Платформа или твёрдый тайл — на чём можно стоять. */
  isStandable(cx: number, cy: number) {
    const info = TILE_INFO[this.get(cx, cy)];
    return info.solid || !!info.oneWay;
  }

  set(i: number, v: number) {
    this.t[i] = v;
    this.hp[i] = TILE_INFO[v].hp;
    this.crack[i] = 0;
    this.version++;
  }

  /**
   * Наносит урон тайлу. Возвращает 'destroyed', 'cracked' (изменился уровень трещин) или null.
   */
  damage(cx: number, cy: number, amount: number): 'destroyed' | 'cracked' | null {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return null;
    const i = this.idx(cx, cy);
    const info = TILE_INFO[this.t[i]];
    if (!info.hp) return null;
    this.hp[i] -= amount;
    if (this.hp[i] <= 0) {
      this.set(i, T.EMPTY);
      return 'destroyed';
    }
    const lvl = Math.min(3, Math.floor((1 - this.hp[i] / info.hp) * 4));
    if (lvl !== this.crack[i]) {
      this.crack[i] = lvl;
      return 'cracked';
    }
    return null;
  }

  /** Луч через сетку (Amanatides–Woo). Платформы пропускаются. */
  raycast(x0: number, y0: number, x1: number, y1: number): RayHit | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let cx = Math.floor(x0 / TILE);
    let cy = Math.floor(y0 / TILE);
    const endX = Math.floor(x1 / TILE);
    const endY = Math.floor(y1 / TILE);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = stepX ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = stepY ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = stepX > 0 ? ((cx + 1) * TILE - x0) / dx : stepX < 0 ? (cx * TILE - x0) / dx : Infinity;
    let tMaxY = stepY > 0 ? ((cy + 1) * TILE - y0) / dy : stepY < 0 ? (cy * TILE - y0) / dy : Infinity;
    let nx = 0;
    let ny = 0;
    let t = 0;
    if (this.isSolid(cx, cy)) {
      return { x: x0, y: y0, cx, cy, nx: -stepX, ny: -stepY, t: 0, tile: this.get(cx, cy) };
    }
    for (let guard = 0; guard < 2000; guard++) {
      if (cx === endX && cy === endY) return null;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
        nx = -stepX;
        ny = 0;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        cy += stepY;
        nx = 0;
        ny = -stepY;
      }
      if (t > 1) return null;
      if (cy >= this.h + 2) return null;
      if (this.isSolid(cx, cy)) {
        return { x: x0 + dx * t, y: y0 + dy * t, cx, cy, nx, ny, t, tile: this.get(cx, cy) };
      }
    }
    return null;
  }

  /** Есть ли прямая видимость. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number) {
    return !this.raycast(x0, y0, x1, y1);
  }

  encode(): string {
    let s = '';
    for (let i = 0; i < this.t.length; i++) s += String.fromCharCode(48 + this.t[i]);
    return s;
  }

  static decode(w: number, h: number, s: string): TileMap {
    const arr = new Uint8Array(w * h);
    for (let i = 0; i < arr.length; i++) arr[i] = s.charCodeAt(i) - 48;
    return new TileMap(w, h, arr);
  }
}

export interface Box {
  x: number; // центр
  y: number; // центр
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  onGround: boolean;
  hitCeil: boolean;
  /** -1 — стена слева, 1 — справа, 0 — нет. */
  wall: number;
  /** Тайл, в который упёрлись (для урона от удара и т.п.). */
  impactVX: number;
  impactVY: number;
}

/**
 * Сдвигает AABB по карте с разрешением коллизий по осям, с подшагами,
 * чтобы быстрые тела (ракетный прыжок) не проходили сквозь стены.
 */
export function moveBox(map: TileMap, b: Box, dt: number, oneWay = true, dropThrough = false): MoveResult {
  const res: MoveResult = { hitX: false, hitY: false, onGround: false, hitCeil: false, wall: 0, impactVX: 0, impactVY: 0 };
  const totalX = b.vx * dt;
  const totalY = b.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(totalX), Math.abs(totalY)) / (TILE * 0.4)));
  const sx = totalX / steps;
  const sy = totalY / steps;
  const hw = b.w / 2;
  const hh = b.h / 2;
  for (let s = 0; s < steps; s++) {
    // --- X ---
    if (sx !== 0 && !res.hitX) {
      b.x += sx;
      const top = Math.floor((b.y - hh + 0.01) / TILE);
      const bot = Math.floor((b.y + hh - 0.01) / TILE);
      if (sx > 0) {
        const col = Math.floor((b.x + hw) / TILE);
        for (let r = top; r <= bot; r++) {
          if (map.isSolid(col, r)) {
            b.x = col * TILE - hw - 0.001;
            res.hitX = true;
            res.wall = 1;
            res.impactVX = b.vx;
            break;
          }
        }
      } else {
        const col = Math.floor((b.x - hw) / TILE);
        for (let r = top; r <= bot; r++) {
          if (map.isSolid(col, r)) {
            b.x = (col + 1) * TILE + hw + 0.001;
            res.hitX = true;
            res.wall = -1;
            res.impactVX = b.vx;
            break;
          }
        }
      }
    }
    // --- Y ---
    if (sy !== 0 && !res.hitY) {
      const prevBottom = b.y + hh;
      b.y += sy;
      const left = Math.floor((b.x - hw + 0.01) / TILE);
      const right = Math.floor((b.x + hw - 0.01) / TILE);
      if (sy > 0) {
        const row = Math.floor((b.y + hh) / TILE);
        for (let c = left; c <= right; c++) {
          const tt = map.get(c, row);
          const info = TILE_INFO[tt];
          const blocks = info.solid || (oneWay && !dropThrough && info.oneWay && prevBottom <= row * TILE + 0.5);
          if (blocks) {
            b.y = row * TILE - hh - 0.001;
            res.hitY = true;
            res.onGround = true;
            res.impactVY = b.vy;
            break;
          }
        }
      } else {
        const row = Math.floor((b.y - hh) / TILE);
        for (let c = left; c <= right; c++) {
          if (map.isSolid(c, row)) {
            b.y = (row + 1) * TILE + hh + 0.001;
            res.hitY = true;
            res.hitCeil = true;
            res.impactVY = b.vy;
            break;
          }
        }
      }
    }
  }
  if (res.hitX) b.vx = 0;
  if (res.hitY) b.vy = 0;
  return res;
}

/** Проверка: стоит ли тело на земле (без движения). */
export function groundCheck(map: TileMap, b: Box): boolean {
  const hw = b.w / 2;
  const footY = b.y + b.h / 2 + 1;
  const row = Math.floor(footY / TILE);
  const left = Math.floor((b.x - hw + 0.01) / TILE);
  const right = Math.floor((b.x + hw - 0.01) / TILE);
  for (let c = left; c <= right; c++) {
    const info = TILE_INFO[map.get(c, row)];
    if (info.solid) return true;
    if (info.oneWay && Math.abs(b.y + b.h / 2 - row * TILE) < 2) return true;
  }
  return false;
}

/** Проверка касания стены сбоку. */
export function wallCheck(map: TileMap, b: Box, dir: number): boolean {
  const x = dir > 0 ? b.x + b.w / 2 + 2 : b.x - b.w / 2 - 2;
  const col = Math.floor(x / TILE);
  const top = Math.floor((b.y - b.h / 2 + 4) / TILE);
  const bot = Math.floor((b.y + b.h / 2 - 4) / TILE);
  for (let r = top; r <= bot; r++) if (map.isSolid(col, r)) return true;
  return false;
}
