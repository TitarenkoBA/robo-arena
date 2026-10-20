import { TILE } from './constants';
import { pick, rand } from './math';
import { TILE_INFO, TileMap } from './tiles';
import { GameEvent, PROP_INFO, Player } from './types';
import { POWERS, SfxName, WEAPONS } from './weapons';
import { WID_BARREL, WID_FALL } from './world';

export type PKind = 'spark' | 'smoke' | 'debris' | 'confetti' | 'star' | 'glow' | 'bolt' | 'snow' | 'bubble';

export interface Particle {
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  g: number;
  rot: number;
  vr: number;
  collide: boolean;
}

export interface Trace { pts: number[]; color: string; life: number; max: number; width: number; kind: 'trace' | 'beam' | 'chain' }
export interface Ring { x: number; y: number; r: number; life: number; max: number; color: string; dir?: number }
export interface FloatText { x: number; y: number; text: string; color: string; life: number; max: number; size: number }
export interface FeedLine { killer: string; kc: string; victim: string; vc: string; weapon: string; t: number }
export interface Vortex { x: number; y: number; r: number; life: number; max: number }

export type SoundSink = (name: SoundName, x: number, y: number, vol?: number) => void;
export type SoundName = SfxName | 'boom' | 'bigboom' | 'hit' | 'hurt' | 'pop' | 'jump' | 'djump' | 'pad' | 'tele' |
  'pick' | 'pickW' | 'power' | 'break' | 'glass' | 'spawn' | 'ric' | 'end' | 'msg';

const CONFETTI = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2', '#ffa94d', '#ffffff'];

export class Effects {
  particles: Particle[] = [];
  traces: Trace[] = [];
  rings: Ring[] = [];
  texts: FloatText[] = [];
  feed: FeedLine[] = [];
  vortices: Vortex[] = [];
  messages: { text: string; t: number }[] = [];
  shake = 0;
  hitMarker = 0;
  hurtFlash = 0;
  winner = '';

  constructor(private sound: SoundSink) {}

  private add(p: Partial<Particle> & { kind: PKind; x: number; y: number }) {
    if (this.particles.length > 2500) this.particles.splice(0, 200);
    const life = p.life ?? 0.5;
    this.particles.push({
      vx: 0, vy: 0, size: 3, color: '#fff', g: 0, rot: Math.random() * 6.28, vr: 0, collide: false,
      ...p, life, max: life,
    });
  }

  burst(x: number, y: number, n: number, color: string, speed = 300, kind: PKind = 'spark', life = 0.4, size = 2.5, g = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.2, 1) * speed;
      this.add({ kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1) * life, size: rand(0.6, 1.2) * size, color, g, vr: rand(-10, 10) });
    }
  }

  handle(e: GameEvent, players: Map<number, Player>, localId: number, map: TileMap) {
    switch (e.k) {
      case 'shot': {
        const wd = WEAPONS[e.w];
        const p = players.get(e.p);
        if (p) p.muzzle = 0.06;
        this.add({ kind: 'glow', x: e.x, y: e.y, life: 0.08, size: 14, color: wd.color });
        if (e.p === localId && wd.shake) this.shake = Math.max(this.shake, wd.shake);
        if (e.w === 3 || e.w === 4) this.burst(e.x, e.y, 5, '#ccc', 120, 'smoke', 0.4, 6);
        this.sound(wd.sound, e.x, e.y);
        break;
      }
      case 'trace': {
        const wd = WEAPONS[e.w];
        const rail = e.w === 8 || e.w === 13;
        this.traces.push({ pts: e.pts, color: wd.color, life: rail ? 0.6 : 0.09, max: rail ? 0.6 : 0.09, width: rail ? 4 : e.w === 15 ? 3 : 1.5, kind: 'trace' });
        if (rail) {
          for (let i = 0; i + 3 < e.pts.length; i += 2) {
            const [x0, y0, x1, y1] = [e.pts[i], e.pts[i + 1], e.pts[i + 2], e.pts[i + 3]];
            const n = Math.min(60, Math.hypot(x1 - x0, y1 - y0) / 20);
            for (let j = 0; j < n; j++) {
              const t = j / n;
              this.add({ kind: 'spark', x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, vx: rand(-30, 30), vy: rand(-30, 30), life: rand(0.3, 0.7), size: 2, color: wd.color });
            }
          }
        }
        break;
      }
      case 'beam':
        this.traces.push({ pts: [e.x, e.y, e.x2, e.y2], color: WEAPONS[e.w].color, life: 0.07, max: 0.07, width: 3, kind: 'beam' });
        if (Math.random() < 0.5) this.add({ kind: 'spark', x: e.x2, y: e.y2, vx: rand(-200, 200), vy: rand(-200, 200), life: 0.2, size: 2, color: '#e7f5ff' });
        if (Math.random() < 0.25) this.sound('lightning', e.x, e.y, 0.6);
        break;
      case 'chain':
        this.traces.push({ pts: e.pts, color: '#a5d8ff', life: 0.15, max: 0.15, width: 2.5, kind: 'chain' });
        break;
      case 'boom': {
        const big = e.r > 180;
        const wd = WEAPONS[e.w];
        const color = e.w === WID_BARREL ? '#ff922b' : wd?.color ?? '#ffa94d';
        this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35, color });
        this.add({ kind: 'glow', x: e.x, y: e.y, life: 0.25, size: e.r * 0.9, color });
        this.burst(e.x, e.y, Math.min(50, e.r / 3), '#ffe066', e.r * 4, 'spark', 0.5, 3);
        this.burst(e.x, e.y, Math.min(25, e.r / 6), 'rgba(120,120,140,0.5)', e.r * 1.5, 'smoke', 1.1, 14, -60);
        this.burst(e.x, e.y, 8, color, e.r * 2.5, 'star', 0.6, 5, 400);
        this.shake = Math.max(this.shake, Math.min(16, e.r / 10));
        this.sound(big ? 'bigboom' : 'boom', e.x, e.y, Math.min(1.2, e.r / 110));
        break;
      }
      case 'hit': {
        this.burst(e.x, e.y, 8, '#ffffff', 260, 'spark', 0.3, 2.5);
        this.burst(e.x, e.y, 3, '#ffd43b', 200, 'star', 0.5, 4, 300);
        this.texts.push({ x: e.x + rand(-8, 8), y: e.y - 20, text: String(e.d), color: e.d >= 50 ? '#ff922b' : '#ffe066', life: 0.8, max: 0.8, size: e.d >= 50 ? 20 : 15 });
        const p = players.get(e.p);
        if (p) p.hurt = 1;
        if (e.p === localId) {
          this.hurtFlash = Math.min(1, this.hurtFlash + e.d / 60);
          this.shake = Math.max(this.shake, 3);
          this.sound('hurt', e.x, e.y);
        } else {
          this.sound('hit', e.x, e.y, 0.7);
        }
        break;
      }
      case 'wall':
        this.burst(e.x, e.y, 5, e.c, 180, 'spark', 0.25, 2);
        this.add({ kind: 'smoke', x: e.x, y: e.y, vy: -20, life: 0.5, size: 6, color: 'rgba(200,200,210,0.35)' });
        if (Math.random() < 0.3) this.sound('ric', e.x, e.y, 0.4);
        break;
      case 'tile': {
        const info = TILE_INFO[e.t];
        const cx = (e.i % map.w) * TILE + TILE / 2;
        const cy = Math.floor(e.i / map.w) * TILE + TILE / 2;
        for (let i = 0; i < 9; i++) {
          this.add({
            kind: 'debris', x: cx + rand(-12, 12), y: cy + rand(-12, 12), vx: rand(-260, 260), vy: rand(-420, -60),
            life: rand(1, 2), size: rand(4, 8), color: info?.debris || '#aaa', g: 1600, vr: rand(-12, 12), collide: true,
          });
        }
        this.burst(cx, cy, 6, 'rgba(180,170,160,0.4)', 80, 'smoke', 0.8, 12, -30);
        this.sound(e.t === 4 ? 'glass' : 'break', cx, cy);
        break;
      }
      case 'prop': {
        const info = PROP_INFO[e.kind];
        for (let i = 0; i < 12; i++) {
          this.add({
            kind: 'debris', x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), vx: rand(-320, 320), vy: rand(-500, -80),
            life: rand(1, 2), size: rand(4, 9), color: i % 2 ? info.color : info.edge, g: 1600, vr: rand(-12, 12), collide: true,
          });
        }
        this.sound('break', e.x, e.y);
        break;
      }
      case 'pop': {
        // Без крови: робот «лопается» конфетти, болтиками и звёздами.
        for (let i = 0; i < 40; i++) {
          this.add({
            kind: 'confetti', x: e.x, y: e.y, vx: rand(-450, 450), vy: rand(-650, -100), life: rand(1.2, 2.2),
            size: rand(3, 6), color: i % 3 === 0 ? e.c : pick(CONFETTI), g: 900, vr: rand(-15, 15), collide: true,
          });
        }
        for (let i = 0; i < 8; i++) {
          this.add({ kind: 'bolt', x: e.x, y: e.y, vx: rand(-300, 300), vy: rand(-550, -150), life: rand(1.5, 2.5), size: 5, color: '#ced4da', g: 1500, vr: rand(-15, 15), collide: true });
        }
        this.rings.push({ x: e.x, y: e.y, r: 70, life: 0.3, max: 0.3, color: e.c });
        this.texts.push({ x: e.x, y: e.y - 30, text: 'ПУФ!', color: '#ffffff', life: 1, max: 1, size: 26 });
        this.sound('pop', e.x, e.y);
        break;
      }
      case 'kill': {
        const a = players.get(e.a);
        const v = players.get(e.v);
        const weapon = e.w === WID_FALL ? 'пропасть' : e.w === WID_BARREL ? 'бочка' : WEAPONS[e.w]?.name ?? '';
        this.feed.push({ killer: a && a !== v ? a.name : '', kc: a?.color ?? '#fff', victim: v?.name ?? '?', vc: v?.color ?? '#fff', weapon, t: 5 });
        if (this.feed.length > 6) this.feed.shift();
        if (e.a === localId && e.v !== localId) {
          this.hitMarker = 1;
          this.messages.push({ text: `Ты выбил ${v?.name ?? ''}!`, t: 2 });
        }
        break;
      }
      case 'spawn':
        this.rings.push({ x: e.x, y: e.y, r: 50, life: 0.4, max: 0.4, color: '#ffffff' });
        this.burst(e.x, e.y, 16, '#e7f5ff', 250, 'star', 0.5, 4);
        this.sound('spawn', e.x, e.y, 0.6);
        break;
      case 'pick': {
        const power = e.kind === 'power';
        const color = power ? POWERS[e.sub]?.color ?? '#fff' : e.kind === 'weapon' ? WEAPONS[e.sub].color : e.kind.startsWith('armor') ? '#74c0fc' : '#69db7c';
        this.burst(e.x, e.y, 14, color, 200, 'star', 0.5, 4);
        this.sound(power ? 'power' : e.kind === 'weapon' ? 'pickW' : 'pick', e.x, e.y);
        if (e.p === localId) {
          const label = e.kind === 'weapon' ? WEAPONS[e.sub].name : power ? POWERS[e.sub].name : e.kind === 'health' ? '+25 здоровья'
            : e.kind === 'mega' ? '+100 здоровья' : e.kind === 'armor' ? '+50 брони' : e.kind === 'armorBig' ? '+100 брони' : 'Патроны';
          this.texts.push({ x: e.x, y: e.y - 20, text: label, color, life: 1.2, max: 1.2, size: 16 });
        }
        break;
      }
      case 'jump': {
        const kind = e.t;
        if (kind === 'pad') {
          this.burst(e.x, e.y, 14, '#63e6be', 300, 'spark', 0.4, 3);
          this.sound('pad', e.x, e.y);
        } else if (kind === 'tele') {
          this.burst(e.x, e.y - 20, 20, '#d0bfff', 250, 'star', 0.5, 4);
          this.sound('tele', e.x, e.y);
        } else if (kind === 'dj') {
          this.rings.push({ x: e.x, y: e.y, r: 22, life: 0.25, max: 0.25, color: '#ffffff' });
          this.sound('djump', e.x, e.y, 0.5);
        } else {
          this.burst(e.x, e.y, 5, 'rgba(220,220,230,0.5)', 90, 'smoke', 0.35, 5);
          this.sound('jump', e.x, e.y, 0.4);
        }
        break;
      }
      case 'vortex':
        if (e.r < 0) {
          // Ударная волна (отрицательный радиус = конус).
          this.rings.push({ x: e.x, y: e.y, r: -e.r, life: 0.3, max: 0.3, color: '#ffffff', dir: e.d });
          this.shake = Math.max(this.shake, 4);
        } else {
          this.vortices.push({ x: e.x, y: e.y, r: e.r, life: e.d, max: e.d });
          this.sound('vortex', e.x, e.y);
        }
        break;
      case 'msg':
        this.messages.push({ text: e.text, t: 3 });
        if (this.messages.length > 4) this.messages.shift();
        this.sound('msg', 0, 0, 0.5);
        break;
      case 'end':
        this.winner = e.winner;
        this.sound('end', 0, 0);
        break;
      case 'crack':
      case 'item':
        break;
    }
  }

  /** Локальные эффекты движения своего игрока (предсказание). */
  localJump(kind: 'j' | 'dj' | 'wj' | 'pad' | 'tele', x: number, y: number) {
    this.handle({ k: 'jump', p: -1, x, y, t: kind }, new Map(), -2, null as unknown as TileMap);
  }

  update(dt: number, map: TileMap, players: Iterable<Player>) {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.g * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (p.collide && map.isSolidPx(nx, ny)) {
        if (map.isSolidPx(p.x, ny)) {
          p.vy = -p.vy * 0.35;
          p.vx *= 0.7;
        } else {
          p.vx = -p.vx * 0.4;
        }
        p.vr *= 0.6;
      } else {
        p.x = nx;
        p.y = ny;
      }
      if (p.kind === 'smoke') {
        p.vx *= 1 - dt * 2;
        p.vy *= 1 - dt * 2;
        p.size += dt * 10;
      }
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.traces) t.life -= dt;
    this.traces = this.traces.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 40;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    for (const v of this.vortices) {
      v.life -= dt;
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2;
        const r = v.r * rand(0.6, 1);
        this.add({ kind: 'spark', x: v.x + Math.cos(a) * r, y: v.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 2, vy: -Math.sin(a) * r * 2, life: 0.45, size: 2.5, color: '#b197fc' });
      }
    }
    this.vortices = this.vortices.filter((v) => v.life > 0);

    // Следы от эффектов на игроках
    for (const p of players) {
      p.hurt = Math.max(0, p.hurt - dt * 4);
      p.muzzle = Math.max(0, p.muzzle - dt);
      if (!p.alive) continue;
      if (p.slow > 0 && Math.random() < 0.3) this.add({ kind: 'snow', x: p.rx + rand(-12, 12), y: p.ry + rand(-20, 20), vy: 30, life: 0.8, size: 3, color: '#e3fafc' });
      if (p.powers.jet > 0 && !p.onGround && (p.input.jump || p.vy < -150)) {
        this.add({ kind: 'spark', x: p.rx - p.facing * 8, y: p.ry + 10, vx: rand(-40, 40), vy: rand(200, 400), life: 0.3, size: 3, color: pick(['#ff922b', '#ffd43b']) });
      }
      if (p.powers.quad > 0 && Math.random() < 0.3) this.add({ kind: 'glow', x: p.rx + rand(-14, 14), y: p.ry + rand(-20, 20), vy: -40, life: 0.4, size: 6, color: '#9b6bff' });
    }
  }
}
