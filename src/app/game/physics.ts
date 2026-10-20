import { PHYS, TILE } from './constants';
import { clamp } from './math';
import { T, TileMap, groundCheck, moveBox, wallCheck } from './tiles';
import { Input, JumpKind, Player, Prop } from './types';

export type MoveFx = (kind: JumpKind, p: Player) => void;

/**
 * Шаг движения игрока. Одна и та же функция работает на хосте (авторитетно)
 * и на клиенте (предсказание своего персонажа), поэтому она детерминирована
 * и не трогает ничего, кроме самого игрока (и, при push=true, ящиков).
 */
export function stepMovement(
  p: Player,
  inp: Input,
  map: TileMap,
  props: Prop[],
  dt: number,
  push: boolean,
  fx?: MoveFx,
) {
  p.aim = inp.aim;
  p.facing = Math.cos(inp.aim) >= 0 ? 1 : -1;
  p.teleCd = Math.max(0, p.teleCd - dt);
  p.dropTimer = Math.max(0, p.dropTimer - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

  const haste = p.powers.haste > 0 ? 1.3 : 1;
  const slowF = p.slow > 0 ? 0.55 : 1;
  const mult = haste * slowF;

  // Захвачен пузырём: медленно всплывает, управление почти отключено.
  if (p.bubble > 0) {
    p.vx *= 1 - 3 * dt;
    p.vx += inp.mx * 200 * dt;
    p.vy += (-140 - p.vy) * 3 * dt;
    moveBox(map, p, dt, false);
    p.jumpHeld = inp.jump;
    return;
  }

  const target = clamp(inp.mx, -1, 1) * PHYS.runSpeed * mult;
  if (p.onGround) {
    if (inp.mx !== 0) {
      const accel = PHYS.groundAccel * dt;
      if (Math.abs(p.vx - target) <= accel) p.vx = target;
      else p.vx += Math.sign(target - p.vx) * accel;
    } else {
      const f = PHYS.groundFriction * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }
    // Скорость выше бега после взрыва гасится быстрее.
    if (Math.abs(p.vx) > PHYS.runSpeed * mult * 1.05) p.vx *= 1 - 4 * dt;
  } else {
    const max = PHYS.airMaxSpeed * mult;
    if (inp.mx !== 0) {
      const same = Math.sign(inp.mx) === Math.sign(p.vx);
      if (!same) p.vx += inp.mx * PHYS.airAccel * 1.4 * dt;
      else if (Math.abs(p.vx) < max) p.vx = clamp(p.vx + inp.mx * PHYS.airAccel * dt, -max, max);
    }
    if (Math.abs(p.vx) > max) p.vx *= 1 - PHYS.airDrag * dt;
  }

  // Прыжки
  const pressed = inp.jump && !p.jumpHeld;
  if (pressed) p.jumpBuffer = PHYS.jumpBuffer;
  if (p.jumpBuffer > 0) {
    if (p.onGround || p.coyote > 0) {
      p.vy = -PHYS.jumpVel * (p.slow > 0 ? 0.8 : 1);
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.onGround = false;
      p.jumpRising = true;
      fx?.('j', p);
    } else if (p.wallDir !== 0 && pressed) {
      p.vy = -PHYS.wallJumpVelY;
      p.vx = -p.wallDir * PHYS.wallJumpVelX;
      p.jumpBuffer = 0;
      p.jumpRising = true;
      fx?.('wj', p);
    } else if (pressed && p.airJumps < 1 && p.powers.jet <= 0) {
      p.vy = -PHYS.doubleJumpVel;
      p.airJumps++;
      p.jumpBuffer = 0;
      p.jumpRising = true;
      fx?.('dj', p);
    }
  }
  // Переменная высота прыжка
  if (p.jumpRising) {
    if (p.vy >= 0) p.jumpRising = false;
    else if (!inp.jump) {
      p.vy *= 0.5;
      p.jumpRising = false;
    }
  }

  // Гравитация, реактивный ранец, скольжение по стене
  p.vy += PHYS.gravity * dt;
  if (p.powers.jet > 0 && inp.jump && !p.onGround && !pressed) {
    p.vy -= 3900 * dt;
    if (p.vy < -520) p.vy = -520;
  }
  if (p.wallDir !== 0 && p.vy > PHYS.wallSlideMax && Math.sign(inp.mx) === p.wallDir) p.vy = PHYS.wallSlideMax;
  if (p.vy > PHYS.maxFall) p.vy = PHYS.maxFall;

  // Спрыгнуть с платформы
  if (inp.down && p.onGround && standingOnPlatform(map, p)) p.dropTimer = 0.25;

  const res = moveBox(map, p, dt, true, p.dropTimer > 0);
  let onGround = res.onGround;
  if (res.hitCeil) p.jumpRising = false;

  // Ящики и бочки — твёрдые для игроков.
  for (const o of props) {
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const ox = (p.w + o.w) / 2 - Math.abs(dx);
    const oy = (p.h + o.h) / 2 - Math.abs(dy);
    if (ox <= 0 || oy <= 0) continue;
    if (oy < ox && (dy < 0 ? p.vy >= -10 : true)) {
      if (dy < 0) {
        p.y -= oy;
        if (p.vy > 0) p.vy = 0;
        onGround = true;
      } else {
        p.y += oy;
        if (p.vy < 0) p.vy = 0;
      }
    } else {
      const s = Math.sign(dx) || 1;
      if (push) {
        // Толкаем ящик: делим смещение по массам.
        const share = 1 / (1 + o.mass);
        p.x += s * ox * share;
        o.x -= s * ox * (1 - share);
        o.vx = p.vx * 0.85;
      } else {
        p.x += s * ox;
      }
      if (Math.sign(p.vx) === -s) p.vx *= 0.5;
    }
  }

  if (!onGround && p.vy >= 0) onGround = groundCheck(map, p);
  p.onGround = onGround;
  if (onGround) {
    p.coyote = PHYS.coyoteTime;
    p.airJumps = 0;
    p.wallDir = 0;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
    p.wallDir = wallCheck(map, p, -1) ? -1 : wallCheck(map, p, 1) ? 1 : 0;
  }

  // Прыжковая площадка
  if (onGround) {
    const footRow = Math.floor((p.y + p.h / 2 + 2) / TILE);
    const l = Math.floor((p.x - p.w / 2 + 2) / TILE);
    const r = Math.floor((p.x + p.w / 2 - 2) / TILE);
    for (let c = l; c <= r; c++) {
      if (map.get(c, footRow) === T.JUMPPAD) {
        p.vy = -PHYS.jumpPadVel;
        p.onGround = false;
        p.jumpRising = false;
        p.airJumps = 0;
        fx?.('pad', p);
        break;
      }
    }
  }

  // Телепорт
  if (p.teleCd <= 0) {
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    const i = map.idx(cx, cy);
    if (map.get(cx, cy) === T.TELE) {
      const to = map.tele.get(i);
      if (to !== undefined) {
        const tx = to % map.w;
        const ty = Math.floor(to / map.w);
        p.x = tx * TILE + TILE / 2;
        p.y = ty * TILE + TILE / 2;
        p.teleCd = 0.8;
        p.rx = p.x;
        p.ry = p.y;
        fx?.('tele', p);
      }
    }
  }

  p.jumpHeld = inp.jump;
}

function standingOnPlatform(map: TileMap, p: Player) {
  const row = Math.floor((p.y + p.h / 2 + 2) / TILE);
  const l = Math.floor((p.x - p.w / 2 + 1) / TILE);
  const r = Math.floor((p.x + p.w / 2 - 1) / TILE);
  let anyPlatform = false;
  for (let c = l; c <= r; c++) {
    const t = map.get(c, row);
    if (t === T.PLATFORM) anyPlatform = true;
    else if (t !== T.EMPTY) return false;
  }
  return anyPlatform;
}

/** Импульс от взрыва и т.п. */
export function applyImpulse(p: { vx: number; vy: number; onGround?: boolean }, ix: number, iy: number) {
  p.vx += ix;
  p.vy += iy;
  if (iy < -50 && p.onGround !== undefined) p.onGround = false;
}
