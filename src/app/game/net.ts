import { DT, PHYS } from './constants';
import { ItemKind, PropKind, mapById, parseMap, ParsedMap } from './maps';
import { stepMovement, MoveFx } from './physics';
import { TileMap } from './tiles';
import {
  GameEvent, GameSettings, Input, Item, PROP_INFO, Player, Projectile, Prop, RosterEntry, emptyInput,
} from './types';
import { WEAPONS } from './weapons';
import type { World } from './world';

// ============================================================ сообщения

export type ClientMsg =
  | { t: 'hello'; name: string; color: string }
  | { t: 'in'; l: number[][] }
  | { t: 'ping'; c: number; r?: number }
  | { t: 'chat'; text: string };

export type HostMsg =
  | { t: 'welcome'; you: number; settings: GameSettings; tiles: string; crack: number[]; gen: number }
  | { t: 'roster'; l: RosterEntry[] }
  | { t: 's'; k: number; tl: number; ph: number; P: number[]; R: number[]; O: number[]; I: string; me?: MeState }
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'pong'; c: number }
  | { t: 'chat'; from: string; text: string }
  | { t: 'full' };

export interface MeState {
  a: number;
  o: number;
  am: number[];
  m: number[];
}

const PROP_KINDS: PropKind[] = ['crate', 'metal', 'barrel'];
const P_STRIDE = 12;
const R_STRIDE = 7;
const O_STRIDE = 5;

const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeInput(i: Input): number[] {
  const flags = (i.jump ? 1 : 0) | (i.down ? 2 : 0) | (i.fire ? 4 : 0);
  return [i.seq, Math.round(i.mx * 100) / 100, flags, Math.round(i.aim * 1000), i.w];
}

export function decodeInput(a: number[]): Input {
  return { seq: a[0], mx: a[1], jump: !!(a[2] & 1), down: !!(a[2] & 2), fire: !!(a[2] & 4), aim: a[3] / 1000, w: a[4] };
}

function playerFlags(p: Player) {
  return (p.alive ? 1 : 0) | (p.onGround ? 2 : 0) | (p.bubble > 0 ? 4 : 0) | (p.slow > 0 ? 8 : 0) |
    (p.spawnShield > 0 ? 16 : 0) | (p.muzzle > 0 ? 32 : 0) | (p.facing < 0 ? 64 : 0);
}

function powerMask(p: Player) {
  return (p.powers.quad > 0 ? 1 : 0) | (p.powers.haste > 0 ? 2 : 0) | (p.powers.shield > 0 ? 4 : 0) |
    (p.powers.jet > 0 ? 8 : 0) | (p.powers.regen > 0 ? 16 : 0);
}

/** Общая часть снапшота (одинакова для всех клиентов). */
export function encodeSnapshot(world: World, tick: number): Omit<Extract<HostMsg, { t: 's' }>, 'me'> {
  const P: number[] = [];
  for (const p of world.players.values()) {
    P.push(p.id, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), Math.round(p.aim * 100),
      Math.ceil(p.hp), Math.ceil(p.armor), p.weapon, playerFlags(p), Math.round(p.spin * 10), powerMask(p));
  }
  const R: number[] = [];
  for (const r of world.projectiles) {
    R.push(r.id, r.wid, Math.round(r.x), Math.round(r.y), Math.round(r.vx), Math.round(r.vy), (r.stuck ? 1 : 0) | (r.active > 0 ? 2 : 0));
  }
  const O: number[] = [];
  for (const o of world.props) {
    O.push(o.id, PROP_KINDS.indexOf(o.kind), Math.round(o.x), Math.round(o.y), Math.round((o.hp / o.maxHp) * 100));
  }
  let I = '';
  for (const it of world.items) I += it.active ? String.fromCharCode(65 + it.sub) : '0';
  return { t: 's', k: tick, tl: Math.max(0, Math.ceil(world.timeLeft)), ph: world.phase === 'end' ? 1 : 0, P, R, O, I };
}

export function encodeMe(p: Player): MeState {
  return {
    a: p.lastAck,
    o: p.owned,
    am: p.ammo.slice(),
    m: [
      r2(p.x), r2(p.y), r2(p.vx), r2(p.vy),
      (p.onGround ? 1 : 0) | (p.jumpHeld ? 2 : 0) | (p.jumpRising ? 4 : 0),
      r2(p.coyote), r2(p.jumpBuffer), p.airJumps, p.wallDir, r2(p.dropTimer), r2(p.teleCd),
      r2(p.slow), r2(p.bubble), r2(p.powers.quad), r2(p.powers.haste), r2(p.powers.shield), r2(p.powers.jet),
      r2(p.powers.regen), r2(p.respawn), r2(p.spawnShield), p.weapon, p.lastReqW,
    ],
  };
}

function applyMe(p: Player, me: MeState) {
  const m = me.m;
  p.owned = me.o;
  p.ammo = me.am;
  p.x = m[0];
  p.y = m[1];
  p.vx = m[2];
  p.vy = m[3];
  p.onGround = !!(m[4] & 1);
  p.jumpHeld = !!(m[4] & 2);
  p.jumpRising = !!(m[4] & 4);
  p.coyote = m[5];
  p.jumpBuffer = m[6];
  p.airJumps = m[7];
  p.wallDir = m[8];
  p.dropTimer = m[9];
  p.teleCd = m[10];
  p.slow = m[11];
  p.bubble = m[12];
  p.powers.quad = m[13];
  p.powers.haste = m[14];
  p.powers.shield = m[15];
  p.powers.jet = m[16];
  p.powers.regen = m[17];
  p.respawn = m[18];
  p.spawnShield = m[19];
  p.weapon = m[20];
  p.lastReqW = m[21];
}

// ============================================================ клиентское состояние

interface Remote {
  sx: number;
  sy: number;
  svx: number;
  svy: number;
  at: number;
}

export class ClientState {
  parsed: ParsedMap;
  map: TileMap;
  settings: GameSettings;
  readonly players = new Map<number, Player>();
  readonly projectiles = new Map<number, Projectile>();
  readonly props = new Map<number, Prop>();
  items: Item[];
  roster: RosterEntry[] = [];
  timeLeft = 0;
  phase: 'play' | 'end' = 'play';
  me: Player | null = null;
  readonly myId: number;
  gen: number;

  private remote = new Map<string, Remote>();
  private pending: Input[] = [];
  /** Визуальное смещение, сглаживающее коррекцию предсказания. */
  private corr = { x: 0, y: 0 };
  lastSnapAt = 0;
  private lastTick = -1;

  constructor(w: Extract<HostMsg, { t: 'welcome' }>) {
    this.myId = w.you;
    this.settings = w.settings;
    this.gen = w.gen;
    this.parsed = parseMap(mapById(w.settings.mapId));
    const decoded = TileMap.decode(this.parsed.tiles.w, this.parsed.tiles.h, w.tiles);
    this.parsed.tiles.tele.forEach((v, k) => decoded.tele.set(k, v));
    for (let i = 0; i < w.crack.length; i += 2) decoded.crack[w.crack[i]] = w.crack[i + 1];
    this.map = decoded;
    this.items = this.parsed.items.map((it, i) => ({ id: i, kind: it.kind as ItemKind, x: it.x, y: it.y, active: false, timer: 0, sub: 0 }));
  }

  /** Сохраняем ввод для пересимуляции и сразу применяем его локально. */
  predict(inp: Input, fx: MoveFx) {
    const me = this.me;
    if (!me || !me.alive) return;
    this.pending.push(inp);
    if (this.pending.length > 120) this.pending.shift();
    stepMovement(me, inp, this.map, [...this.props.values()], DT, false, fx);
    me.input = inp;
  }

  applySnapshot(s: Extract<HostMsg, { t: 's' }>, now: number) {
    // Канал снапшотов неупорядоченный — устаревшие пакеты отбрасываем.
    if (s.k <= this.lastTick) return;
    this.lastTick = s.k;
    this.lastSnapAt = now;
    this.timeLeft = s.tl;
    this.phase = s.ph ? 'end' : 'play';
    const seen = new Set<number>();
    for (let i = 0; i < s.P.length; i += P_STRIDE) {
      const id = s.P[i];
      seen.add(id);
      let p = this.players.get(id);
      if (!p) {
        const r = this.roster.find((x) => x.id === id);
        p = new Player(id, r?.name ?? '?', r?.color ?? '#fff', r?.team ?? -1, r?.bot ?? false);
        p.x = p.rx = s.P[i + 1];
        p.y = p.ry = s.P[i + 2];
        this.players.set(id, p);
        if (id === this.myId) this.me = p;
      }
      const flags = s.P[i + 9];
      const wasAlive = p.alive;
      p.alive = !!(flags & 1);
      p.hp = s.P[i + 6];
      p.armor = s.P[i + 7];
      p.spin = s.P[i + 10] / 10;
      const pm = s.P[i + 11];
      if (id !== this.myId) {
        p.aim = s.P[i + 5] / 100;
        p.weapon = s.P[i + 8];
        p.onGround = !!(flags & 2);
        p.bubble = flags & 4 ? 1 : 0;
        p.slow = flags & 8 ? 1 : 0;
        p.spawnShield = flags & 16 ? 1 : 0;
        p.facing = flags & 64 ? -1 : 1;
        p.powers.quad = pm & 1 ? 1 : 0;
        p.powers.haste = pm & 2 ? 1 : 0;
        p.powers.shield = pm & 4 ? 1 : 0;
        p.powers.jet = pm & 8 ? 1 : 0;
        p.powers.regen = pm & 16 ? 1 : 0;
        this.remote.set('p' + id, { sx: s.P[i + 1], sy: s.P[i + 2], svx: s.P[i + 3], svy: s.P[i + 4], at: now });
        p.x = s.P[i + 1];
        p.y = s.P[i + 2];
        p.vx = s.P[i + 3];
        p.vy = s.P[i + 4];
        if (!wasAlive && p.alive) {
          p.rx = p.x;
          p.ry = p.y;
        }
      }
      if (flags & 32) p.muzzle = 0.06;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);

    // Своё состояние: принимаем авторитетное и пересимулируем неподтверждённый ввод.
    if (s.me && this.me) {
      const me = this.me;
      const ox = me.x;
      const oy = me.y;
      const wasAlive = me.alive;
      applyMe(me, s.me);
      while (this.pending.length && this.pending[0].seq <= s.me.a) this.pending.shift();
      if (me.alive) {
        const props = [...this.props.values()];
        for (const inp of this.pending) stepMovement(me, inp, this.map, props, DT, false);
      }
      const ex = ox - me.x;
      const ey = oy - me.y;
      if (wasAlive && me.alive && Math.hypot(ex, ey) < 120) {
        this.corr.x += ex;
        this.corr.y += ey;
      } else {
        this.corr.x = 0;
        this.corr.y = 0;
        me.rx = me.x;
        me.ry = me.y;
      }
    }

    const seenR = new Set<number>();
    for (let i = 0; i < s.R.length; i += R_STRIDE) {
      const id = s.R[i];
      seenR.add(id);
      let r = this.projectiles.get(id);
      if (!r) {
        r = {
          id, wid: s.R[i + 1], owner: -1, team: -1, x: s.R[i + 2], y: s.R[i + 3], vx: s.R[i + 4], vy: s.R[i + 5],
          age: 0, life: 1, bounces: 0, stuck: false, mult: 1, hit: [], active: 0, rx: s.R[i + 2], ry: s.R[i + 3],
          ox: s.R[i + 2], oy: s.R[i + 3],
        };
        this.projectiles.set(id, r);
      }
      r.x = s.R[i + 2];
      r.y = s.R[i + 3];
      r.vx = s.R[i + 4];
      r.vy = s.R[i + 5];
      r.stuck = !!(s.R[i + 6] & 1);
      r.active = s.R[i + 6] & 2 ? 1 : 0;
      this.remote.set('r' + id, { sx: r.x, sy: r.y, svx: r.vx, svy: r.vy, at: now });
    }
    for (const id of [...this.projectiles.keys()]) {
      if (!seenR.has(id)) {
        this.projectiles.delete(id);
        this.remote.delete('r' + id);
      }
    }

    const seenO = new Set<number>();
    for (let i = 0; i < s.O.length; i += O_STRIDE) {
      const id = s.O[i];
      seenO.add(id);
      let o = this.props.get(id);
      const kind = PROP_KINDS[s.O[i + 1]];
      const info = PROP_INFO[kind];
      if (!o) {
        o = {
          id, home: -1, kind, x: s.O[i + 2], y: s.O[i + 3], w: info.w, h: info.h, vx: 0, vy: 0, hp: info.hp, maxHp: info.hp,
          mass: info.mass, onGround: false, lastHitBy: -1, rx: s.O[i + 2], ry: s.O[i + 3], ox: s.O[i + 2], oy: s.O[i + 3],
        };
        this.props.set(id, o);
      }
      o.x = s.O[i + 2];
      o.y = s.O[i + 3];
      o.hp = (s.O[i + 4] / 100) * o.maxHp;
    }
    for (const id of [...this.props.keys()]) if (!seenO.has(id)) this.props.delete(id);

    for (let i = 0; i < this.items.length && i < s.I.length; i++) {
      const ch = s.I[i];
      this.items[i].active = ch !== '0';
      if (ch !== '0') this.items[i].sub = ch.charCodeAt(0) - 65;
    }
  }

  applyEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.k === 'tile') this.map.set(e.i, e.v);
      else if (e.k === 'crack') this.map.crack[e.i] = e.l;
    }
  }

  setRoster(l: RosterEntry[]) {
    this.roster = l;
    for (const r of l) {
      const p = this.players.get(r.id);
      if (p) {
        p.name = r.name;
        p.color = r.color;
        p.team = r.team;
        p.frags = r.frags;
        p.deaths = r.deaths;
        p.isBot = r.bot;
        p.ping = r.ping;
      }
    }
  }

  /** Обновление позиций для отрисовки (экстраполяция + сглаживание). */
  updateRender(now: number, frameDt: number) {
    const k = Math.min(1, frameDt * 18);
    for (const p of this.players.values()) {
      if (p === this.me) {
        const decay = Math.pow(0.0001, frameDt); // ~быстрое затухание коррекции
        this.corr.x *= decay;
        this.corr.y *= decay;
        p.rx = p.x + this.corr.x;
        p.ry = p.y + this.corr.y;
        continue;
      }
      const r = this.remote.get('p' + p.id);
      if (!r) continue;
      const ext = Math.min(0.1, Math.max(0, (now - r.at) / 1000));
      const tx = r.sx + r.svx * ext;
      const ty = r.sy + r.svy * ext + (p.onGround ? 0 : 0.5 * PHYS.gravity * ext * ext * 0.3);
      if (Math.hypot(tx - p.rx, ty - p.ry) > 200) {
        p.rx = tx;
        p.ry = ty;
      } else {
        p.rx += (tx - p.rx) * k;
        p.ry += (ty - p.ry) * k;
      }
    }
    for (const r of this.projectiles.values()) {
      const rm = this.remote.get('r' + r.id);
      if (!rm) continue;
      const ext = Math.min(0.15, Math.max(0, (now - rm.at) / 1000));
      const g = (WEAPONS[r.wid].proj?.gravity ?? 0) * PHYS.gravity;
      const tx = rm.sx + rm.svx * ext;
      const ty = rm.sy + rm.svy * ext + 0.5 * g * ext * ext;
      r.rx += (tx - r.rx) * Math.min(1, frameDt * 30);
      r.ry += (ty - r.ry) * Math.min(1, frameDt * 30);
    }
    for (const o of this.props.values()) {
      o.rx += (o.x - o.rx) * k;
      o.ry += (o.y - o.ry) * k;
    }
  }

  resetPrediction() {
    this.pending = [];
    if (this.me) this.me.input = emptyInput();
  }
}
