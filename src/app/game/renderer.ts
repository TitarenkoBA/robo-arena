import { TILE } from './constants';
import { Effects } from './effects';
import { InputManager } from './input';
import { MapDef } from './maps';
import { clamp, mulberry32 } from './math';
import { T, TILE_INFO, TileMap } from './tiles';
import { GameSettings, Item, PROP_INFO, Player, Projectile, Prop } from './types';
import { POWERS, WEAPONS } from './weapons';

export interface View {
  map: TileMap;
  def: MapDef;
  players: Map<number, Player>;
  projectiles: Iterable<Projectile>;
  props: Iterable<Prop>;
  items: Item[];
  me: Player | null;
  timeLeft: number;
  phase: 'play' | 'end';
  settings: GameSettings;
  ping: number;
}

const hash = (i: number) => {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  return (x % 1000) / 1000;
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  private dpr = 1;
  scale = 1;
  cam = { x: 0, y: 0 };
  private tileLayer: HTMLCanvasElement | null = null;
  private tileMap: TileMap | null = null;
  private tileVersion = -1;
  private bgShapes: { x: number; y: number; w: number; h: number; layer: number }[] = [];
  private stars: { x: number; y: number; s: number }[] = [];
  private time = 0;
  private zoom = 1;
  private mini: HTMLCanvasElement | null = null;
  private miniMap: TileMap | null = null;
  private miniVersion = -1;

  constructor(private canvas: HTMLCanvasElement, private fx: Effects, private input: InputManager) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    // На телефонах ограничиваем плотность пикселей — заметно экономит батарею и держит 60 FPS.
    this.dpr = Math.min(this.input.touchMode ? 1.5 : 2, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.input.layout(this.w, this.h);
  }

  // ------------------------------------------------------------- тайлы

  private ensureTiles(map: TileMap) {
    if (this.tileMap === map && this.tileVersion === map.version) return;
    if (this.tileMap !== map) {
      this.tileMap = map;
      this.tileLayer = document.createElement('canvas');
      this.tileLayer.width = map.pxW;
      this.tileLayer.height = map.pxH;
      const rnd = mulberry32(map.w * 31 + map.h);
      this.bgShapes = [];
      for (let i = 0; i < 40; i++) {
        this.bgShapes.push({ x: rnd() * map.pxW * 1.2, y: map.pxH * (0.3 + rnd() * 0.7), w: 60 + rnd() * 220, h: 80 + rnd() * 400, layer: rnd() < 0.5 ? 0 : 1 });
      }
      this.stars = [];
      for (let i = 0; i < 120; i++) this.stars.push({ x: rnd(), y: rnd(), s: rnd() * 2 + 0.5 });
    }
    const c = this.tileLayer!.getContext('2d')!;
    c.clearRect(0, 0, map.pxW, map.pxH);
    for (let cy = 0; cy < map.h; cy++) {
      for (let cx = 0; cx < map.w; cx++) this.drawTile(c, map, cx, cy);
    }
    this.tileVersion = map.version;
  }

  /** Перерисовать одну клетку (после разрушения/трещин), без полной перестройки. */
  redrawTile(map: TileMap, i: number) {
    if (this.tileMap !== map || !this.tileLayer) return;
    const c = this.tileLayer.getContext('2d')!;
    const cx = i % map.w;
    const cy = Math.floor(i / map.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        c.clearRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
        this.drawTile(c, map, x, y);
      }
    }
    this.tileVersion = map.version;
  }

  private drawTile(c: CanvasRenderingContext2D, map: TileMap, cx: number, cy: number) {
    const t = map.get(cx, cy);
    if (t === T.EMPTY || t === T.JUMPPAD || t === T.TELE) return;
    const info = TILE_INFO[t];
    const x = cx * TILE;
    const y = cy * TILE;
    const i = map.idx(cx, cy);
    const h = hash(i);
    if (t === T.PLATFORM) {
      c.fillStyle = info.color;
      c.fillRect(x, y, TILE, 9);
      c.fillStyle = info.edge;
      c.fillRect(x, y, TILE, 3);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x + 4, y + 9, 3, 6);
      c.fillRect(x + TILE - 7, y + 9, 3, 6);
      return;
    }
    const openTop = !map.isSolid(cx, cy - 1);
    c.fillStyle = info.color;
    c.fillRect(x, y, TILE, TILE);
    switch (t) {
      case T.METAL:
        c.fillStyle = 'rgba(255,255,255,0.05)';
        c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        c.fillStyle = '#7d89a3';
        for (const [rx, ry] of [[5, 5], [TILE - 7, 5], [5, TILE - 7], [TILE - 7, TILE - 7]]) c.fillRect(x + rx, y + ry, 2, 2);
        break;
      case T.STONE:
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (let k = 0; k < 4; k++) c.fillRect(x + hash(i + k * 7) * 26, y + hash(i + k * 13) * 26, 5, 4);
        break;
      case T.BRICK: {
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.fillRect(x, y + 15, TILE, 2);
        c.fillRect(x, y + 31, TILE, 1);
        const off = cy % 2 ? 0 : 16;
        c.fillRect(x + off, y, 2, 15);
        c.fillRect(x + ((off + 16) % 32), y + 17, 2, 14);
        c.fillStyle = 'rgba(255,255,255,0.07)';
        c.fillRect(x + 2, y + 2, TILE - 4, 3);
        break;
      }
      case T.WOOD:
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillRect(x, y + 10, TILE, 1);
        c.fillRect(x, y + 21, TILE, 1);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(x + h * 20, y + 3, 8, 2);
        c.fillStyle = '#5c3d1e';
        c.fillRect(x + 3, y + 4, 2, 2);
        c.fillRect(x + TILE - 5, y + 26, 2, 2);
        break;
      case T.GLASS:
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.beginPath();
        c.moveTo(x + 4, y + TILE - 6);
        c.lineTo(x + 12, y + 4);
        c.lineTo(x + 16, y + 4);
        c.lineTo(x + 8, y + TILE - 6);
        c.fill();
        c.strokeStyle = info.edge;
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        break;
    }
    if (t !== T.GLASS) {
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x, y + TILE - 3, TILE, 3);
      if (openTop) {
        c.fillStyle = info.edge;
        c.fillRect(x, y, TILE, 3);
      }
    }
    const cr = map.crack[i];
    if (cr > 0) {
      c.strokeStyle = t === T.GLASS ? 'rgba(255,255,255,0.9)' : 'rgba(20,10,0,0.7)';
      c.lineWidth = 1.5;
      c.beginPath();
      const rnd = mulberry32(i);
      for (let k = 0; k < cr * 2; k++) {
        let px = x + 16 + (rnd() - 0.5) * 8;
        let py = y + 16 + (rnd() - 0.5) * 8;
        c.moveTo(px, py);
        for (let s = 0; s < 3; s++) {
          px += (rnd() - 0.5) * 18;
          py += (rnd() - 0.5) * 18;
          c.lineTo(clamp(px, x, x + TILE), clamp(py, y, y + TILE));
        }
      }
      c.stroke();
    }
  }

  // ------------------------------------------------------------- кадр

  worldToScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.scale + this.w / 2, y: (y - this.cam.y) * this.scale + this.h / 2 };
  }

  aimFromMouse(me: Player | null) {
    if (!me) return 0;
    const s = this.worldToScreen(me.rx, me.ry - 6);
    return Math.atan2(this.input.mouseY - s.y, this.input.mouseX - s.x);
  }

  render(v: View, dt: number) {
    this.time += dt;
    const ctx = this.ctx;
    this.ensureTiles(v.map);
    const me = v.me;

    // Масштаб: примерно 1280×720 мировых пикселей на экране.
    const wantZoom = me && me.alive ? WEAPONS[me.weapon]?.zoom ?? 1 : 1;
    this.zoom += (wantZoom - this.zoom) * Math.min(1, dt * 4);
    const base = Math.min(this.w / 1280, this.h / 720);
    // На телефонах приближаем камеру, чтобы роботы не были крошечными.
    const phone = this.w < 700 || this.h < 500;
    this.scale = Math.max(0.42, phone ? base * 1.35 : base) / this.zoom;

    // Камера
    let tx = v.map.pxW / 2;
    let ty = v.map.pxH / 2;
    if (me) {
      tx = me.rx;
      ty = me.ry;
      if (me.alive) {
        const look = this.input.touchMode ? 140 : 220;
        if (this.input.touchMode) {
          tx += Math.cos(me.aim) * look * 0.6;
          ty += Math.sin(me.aim) * look * 0.4;
        } else {
          tx += clamp((this.input.mouseX - this.w / 2) / this.scale, -look * 2, look * 2) * 0.3;
          ty += clamp((this.input.mouseY - this.h / 2) / this.scale, -look * 2, look * 2) * 0.3;
        }
      }
    }
    const halfW = this.w / 2 / this.scale;
    const halfH = this.h / 2 / this.scale;
    tx = v.map.pxW < halfW * 2 ? v.map.pxW / 2 : clamp(tx, halfW, v.map.pxW - halfW);
    ty = v.map.pxH < halfH * 2 ? v.map.pxH / 2 : clamp(ty, halfH, v.map.pxH - halfH + (v.def.openBottom ? 200 : 0));
    const ck = Math.min(1, dt * 10);
    if (Math.hypot(tx - this.cam.x, ty - this.cam.y) > 900) {
      this.cam.x = tx;
      this.cam.y = ty;
    } else {
      this.cam.x += (tx - this.cam.x) * ck;
      this.cam.y += (ty - this.cam.y) * ck;
    }
    const sh = this.fx.shake;
    const shx = sh ? (Math.random() - 0.5) * sh * 2 : 0;
    const shy = sh ? (Math.random() - 0.5) * sh * 2 : 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(v);

    ctx.save();
    ctx.translate(this.w / 2 + shx, this.h / 2 + shy);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawSpecialTiles(v.map);
    ctx.drawImage(this.tileLayer!, 0, 0);
    for (const it of v.items) this.drawItem(it);
    for (const o of v.props) this.drawProp(o);
    for (const vx of this.fx.vortices) this.drawVortex(vx.x, vx.y, vx.r, vx.life / vx.max);
    for (const p of v.players.values()) if (p.alive) this.drawPlayer(p, p === me, v);
    for (const pr of v.projectiles) this.drawProjectile(pr);
    this.drawEffects();
    ctx.restore();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(v);
  }

  private drawBackground(v: View) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, v.def.bg[0]);
    g.addColorStop(1, v.def.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const s of this.stars) {
      const x = ((s.x * this.w * 1.5 - this.cam.x * 0.05) % this.w + this.w) % this.w;
      const y = ((s.y * this.h * 1.5 - this.cam.y * 0.05) % this.h + this.h) % this.h;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(this.time * 2 + s.x * 50);
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    for (const layer of [0, 1]) {
      const par = layer === 0 ? 0.25 : 0.5;
      ctx.fillStyle = layer === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.18)';
      for (const b of this.bgShapes) {
        if (b.layer !== layer) continue;
        const sx = (b.x - this.cam.x * par) * this.scale * 0.8 + this.w / 2 - v.map.pxW * 0.1 * this.scale;
        const sy = (b.y - this.cam.y * par) * this.scale * 0.8 + this.h / 2;
        ctx.fillRect(sx, sy, b.w * this.scale * 0.8, b.h * this.scale);
      }
    }
    // Сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    const gs = 64 * this.scale;
    const ox = -((this.cam.x * 0.7 * this.scale) % gs);
    const oy = -((this.cam.y * 0.7 * this.scale) % gs);
    ctx.beginPath();
    for (let x = ox; x < this.w; x += gs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.h);
    }
    for (let y = oy; y < this.h; y += gs) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
    }
    ctx.stroke();
  }

  private drawSpecialTiles(map: TileMap) {
    const ctx = this.ctx;
    const x0 = Math.max(0, Math.floor((this.cam.x - this.w / 2 / this.scale) / TILE) - 1);
    const x1 = Math.min(map.w - 1, Math.ceil((this.cam.x + this.w / 2 / this.scale) / TILE) + 1);
    const y0 = Math.max(0, Math.floor((this.cam.y - this.h / 2 / this.scale) / TILE) - 1);
    const y1 = Math.min(map.h - 1, Math.ceil((this.cam.y + this.h / 2 / this.scale) / TILE) + 1);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = map.get(cx, cy);
        const x = cx * TILE;
        const y = cy * TILE;
        if (t === T.JUMPPAD) {
          const pulse = 0.5 + 0.5 * Math.sin(this.time * 6 + cx);
          ctx.fillStyle = '#2b8a6e';
          ctx.fillRect(x + 1, y + 4, TILE - 2, 10);
          ctx.fillStyle = `rgba(99,230,190,${0.6 + pulse * 0.4})`;
          ctx.fillRect(x + 3, y, TILE - 6, 5);
          ctx.globalAlpha = 0.25 * pulse;
          ctx.fillStyle = '#63e6be';
          ctx.beginPath();
          ctx.moveTo(x + 4, y);
          ctx.lineTo(x + TILE - 4, y);
          ctx.lineTo(x + TILE / 2 + 6, y - 50);
          ctx.lineTo(x + TILE / 2 - 6, y - 50);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (t === T.TELE) {
          const cxp = x + TILE / 2;
          const cyp = y + TILE / 2;
          ctx.save();
          ctx.translate(cxp, cyp);
          for (let k = 0; k < 3; k++) {
            ctx.rotate(this.time * (1.5 + k * 0.7));
            ctx.strokeStyle = `rgba(${177 + k * 20},108,255,${0.8 - k * 0.2})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(0, 0, 16 - k * 4, 22 - k * 5, 0, 0, Math.PI * 1.4);
            ctx.stroke();
          }
          ctx.restore();
          ctx.fillStyle = 'rgba(208,191,255,0.25)';
          ctx.beginPath();
          ctx.arc(cxp, cyp, 18, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawItem(it: Item) {
    const ctx = this.ctx;
    const bob = Math.sin(this.time * 3 + it.id) * 4;
    const x = it.x;
    const y = it.y + bob - 2;
    if (!it.active) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x - 12, it.y + 13, 24, 3);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    // Свечение
    let glow = '#69db7c';
    if (it.kind === 'armor' || it.kind === 'armorBig') glow = '#74c0fc';
    if (it.kind === 'weapon') glow = WEAPONS[it.sub]?.color ?? '#fff';
    if (it.kind === 'power') glow = POWERS[it.sub]?.color ?? '#fff';
    if (it.kind === 'ammo') glow = '#ffd43b';
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    rg.addColorStop(0, glow + '88');
    rg.addColorStop(1, glow + '00');
    ctx.fillStyle = rg;
    ctx.fillRect(-26, -26, 52, 52);
    ctx.globalCompositeOperation = 'source-over';
    switch (it.kind) {
      case 'health':
      case 'mega': {
        const s = it.kind === 'mega' ? 1.4 : 1;
        ctx.scale(s, s);
        ctx.fillStyle = '#fff';
        roundRect(ctx, -10, -10, 20, 20, 4);
        ctx.fill();
        ctx.fillStyle = it.kind === 'mega' ? '#20c997' : '#40c057';
        ctx.fillRect(-3, -7, 6, 14);
        ctx.fillRect(-7, -3, 14, 6);
        break;
      }
      case 'armor':
      case 'armorBig': {
        const s = it.kind === 'armorBig' ? 1.3 : 1;
        ctx.scale(s, s);
        ctx.fillStyle = it.kind === 'armorBig' ? '#ffd43b' : '#74c0fc';
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(11, -7);
        ctx.lineTo(9, 5);
        ctx.lineTo(0, 12);
        ctx.lineTo(-9, 5);
        ctx.lineTo(-11, -7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'ammo':
        ctx.fillStyle = '#5c940d';
        roundRect(ctx, -11, -8, 22, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#ffd43b';
        for (let k = -6; k <= 6; k += 6) ctx.fillRect(k - 1.5, -12, 3, 8);
        break;
      case 'weapon': {
        const wd = WEAPONS[it.sub];
        ctx.rotate(Math.sin(this.time * 2) * 0.2);
        this.drawGun(wd.id, 1.4);
        ctx.rotate(-Math.sin(this.time * 2) * 0.2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(wd.short, 0, -14);
        break;
      }
      case 'power': {
        const pw = POWERS[it.sub];
        ctx.rotate(this.time);
        ctx.strokeStyle = pw.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
          ctx.lineTo(Math.cos(a + 0.63) * 7, Math.sin(a + 0.63) * 7);
        }
        ctx.closePath();
        ctx.fillStyle = pw.color + 'aa';
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawProp(o: Prop) {
    const ctx = this.ctx;
    const info = PROP_INFO[o.kind];
    const x = o.rx - o.w / 2;
    const y = o.ry - o.h / 2;
    const dmg = 1 - o.hp / o.maxHp;
    if (o.kind === 'barrel') {
      ctx.fillStyle = info.color;
      roundRect(ctx, x, y, o.w, o.h, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + 7, o.w, 3);
      ctx.fillRect(x, y + o.h - 10, o.w, 3);
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.moveTo(o.rx, o.ry - 6);
      ctx.lineTo(o.rx + 6, o.ry + 5);
      ctx.lineTo(o.rx - 6, o.ry + 5);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(o.rx - 1, o.ry - 2, 2, 4);
    } else {
      ctx.fillStyle = info.color;
      ctx.fillRect(x, y, o.w, o.h);
      ctx.strokeStyle = info.edge;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, o.w - 3, o.h - 3);
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + o.w - 3, y + o.h - 3);
      ctx.moveTo(x + o.w - 3, y + 3);
      ctx.lineTo(x + 3, y + o.h - 3);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (dmg > 0.3) {
      ctx.fillStyle = `rgba(0,0,0,${dmg * 0.4})`;
      ctx.fillRect(x, y, o.w, o.h);
    }
  }

  private drawVortex(x: number, y: number, r: number, f: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      ctx.rotate(this.time * 3 + k);
      ctx.strokeStyle = `rgba(151,117,250,${0.4 * f})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.25 + k * 0.18), 0, Math.PI * 1.2);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
    g.addColorStop(0, `rgba(30,0,60,${f})`);
    g.addColorStop(1, 'rgba(151,117,250,0)');
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Оружие в руках: силуэт по типу. Рисуется в локальных координатах (ствол вправо). */
  private drawGun(wid: number, s = 1) {
    const ctx = this.ctx;
    const wd = WEAPONS[wid];
    if (!wd) return;
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = '#343a40';
    const len = wid === 13 || wid === 8 ? 30 : wid === 1 ? 20 : wid === 10 || wid === 5 || wid === 18 ? 24 : 20;
    const thick = wid === 10 || wid === 5 || wid === 4 || wid === 12 ? 9 : 6;
    if (wid === 1) {
      // Молот
      ctx.fillStyle = '#868e96';
      ctx.fillRect(0, -2, 18, 4);
      ctx.fillStyle = wd.color;
      roundRect(ctx, 14, -9, 10, 18, 3);
      ctx.fill();
    } else {
      roundRect(ctx, -2, -thick / 2, len, thick, 2);
      ctx.fill();
      ctx.fillStyle = wd.color;
      ctx.fillRect(2, -thick / 2 + 1, len - 8, 2);
      if (wid === 12) {
        ctx.fillStyle = '#495057';
        for (let k = -3; k <= 3; k += 3) ctx.fillRect(len - 4, k - 1, 8, 2);
      }
      if (wid === 4) {
        ctx.fillStyle = '#495057';
        ctx.fillRect(len - 6, -thick / 2, 6, thick);
      }
      if (wid === 10 || wid === 14 || wid === 23 || wid === 19) {
        ctx.fillStyle = wd.color;
        ctx.beginPath();
        ctx.arc(len - 3, 0, thick * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (wid === 21) {
        ctx.strokeStyle = '#d9a066';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(len - 4, -10);
        ctx.quadraticCurveTo(len + 4, 0, len - 4, 10);
        ctx.stroke();
      }
      ctx.fillStyle = '#212529';
      ctx.fillRect(2, thick / 2 - 1, 5, 6);
    }
    ctx.restore();
  }

  private drawPlayer(p: Player, isMe: boolean, v: View) {
    const ctx = this.ctx;
    const x = p.rx;
    const y = p.ry;
    const moving = Math.abs(p.vx) > 30 && p.onGround;
    if (moving) p.runPhase += Math.abs(p.vx) * 0.0006 * 16;
    const leg = moving ? Math.sin(p.runPhase) * 6 : 0;
    const color = p.color;
    const facing = Math.cos(p.aim) >= 0 ? 1 : -1;

    ctx.save();
    ctx.translate(x, y);

    // Силовой щит / защита после появления
    if (p.spawnShield > 0 || p.powers.shield > 0) {
      ctx.strokeStyle = p.powers.shield > 0 ? 'rgba(77,171,247,0.8)' : `rgba(255,255,255,${0.4 + 0.3 * Math.sin(this.time * 20)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.powers.quad > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 5, 0, 0, 40);
      g.addColorStop(0, 'rgba(155,107,255,0.5)');
      g.addColorStop(1, 'rgba(155,107,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-40, -40, 80, 80);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.scale(facing, 1);
    // Ноги
    ctx.fillStyle = '#495057';
    if (p.onGround) {
      roundRect(ctx, -8 + leg, 10, 7, 11, 3);
      ctx.fill();
      roundRect(ctx, 1 - leg, 10, 7, 11, 3);
      ctx.fill();
    } else {
      roundRect(ctx, -8, 6, 7, 10, 3);
      ctx.fill();
      roundRect(ctx, 2, 8, 7, 10, 3);
      ctx.fill();
    }
    // Реактивный ранец
    if (p.powers.jet > 0) {
      ctx.fillStyle = '#e8590c';
      roundRect(ctx, -16, -12, 7, 20, 3);
      ctx.fill();
    }
    // Тело
    ctx.fillStyle = color;
    roundRect(ctx, -11, -10, 22, 22, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(ctx, -6, -4, 12, 10, 3);
    ctx.fill();
    // Голова
    ctx.fillStyle = color;
    roundRect(ctx, -10, -26, 20, 16, 6);
    ctx.fill();
    ctx.fillStyle = '#1e2433';
    roundRect(ctx, -3, -22, 12, 8, 3);
    ctx.fill();
    // Глаз смотрит по прицелу
    const ey = clamp(Math.sin(p.aim) * 2, -2, 2);
    ctx.fillStyle = p.slow > 0 ? '#c5f6fa' : '#e7f5ff';
    ctx.fillRect(4, -20 + ey, 3, 3);
    // Антенна
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -26);
    ctx.lineTo(-6, -32);
    ctx.stroke();
    ctx.fillStyle = isMe ? '#ffd43b' : color;
    ctx.beginPath();
    ctx.arc(-6, -33, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Вспышка урона
    if (p.hurt > 0) {
      ctx.globalAlpha = p.hurt * 0.7;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, -11, -26, 22, 38, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (p.slow > 0) {
      ctx.fillStyle = 'rgba(197,246,250,0.35)';
      roundRect(ctx, -12, -27, 24, 40, 6);
      ctx.fill();
    }
    ctx.restore();

    // Рука с оружием
    ctx.save();
    ctx.translate(x, y - 6);
    ctx.rotate(p.aim);
    if (facing < 0) ctx.scale(1, -1);
    ctx.fillStyle = color;
    ctx.fillRect(0, -2, 8, 4);
    ctx.translate(6, 0);
    if (p.weapon === 12 && p.spin > 0) ctx.translate(Math.sin(this.time * 80) * p.spin, 0);
    this.drawGun(p.weapon);
    if (p.muzzle > 0 && p.weapon !== 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = WEAPONS[p.weapon]?.color ?? '#fff';
      ctx.beginPath();
      ctx.arc(24, 0, 7 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // Пузырь-ловушка
    if (p.bubble > 0) {
      ctx.strokeStyle = 'rgba(153,233,242,0.9)';
      ctx.fillStyle = 'rgba(153,233,242,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 4, 34 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x - 12, y - 20, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Имя и здоровье над чужими
    if (!isMe) {
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const tagColor = v.settings.mode === 'tdm' && v.me && p.team === v.me.team ? '#8ce99a' : '#fff';
      ctx.strokeText(p.name, x, y - 46);
      ctx.fillStyle = tagColor;
      ctx.fillText(p.name, x, y - 46);
      const hpw = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - hpw / 2, y - 41, hpw, 4);
      ctx.fillStyle = p.hp > 60 ? '#51cf66' : p.hp > 30 ? '#fcc419' : '#ff922b';
      ctx.fillRect(x - hpw / 2, y - 41, (hpw * clamp(p.hp, 0, 100)) / 100, 4);
      if (p.armor > 0) {
        ctx.fillStyle = '#74c0fc';
        ctx.fillRect(x - hpw / 2, y - 37, (hpw * clamp(p.armor, 0, 100)) / 100, 2);
      }
    }
  }

  private drawProjectile(pr: Projectile) {
    const ctx = this.ctx;
    const wd = WEAPONS[pr.wid];
    if (!wd) return;
    const x = pr.rx;
    const y = pr.ry;
    const a = Math.atan2(pr.vy, pr.vx);
    const size = wd.proj?.size ?? 4;
    ctx.save();
    ctx.translate(x, y);
    switch (pr.wid) {
      case 5:
      case 18: {
        // Ракета
        ctx.rotate(a);
        ctx.fillStyle = '#dee2e6';
        roundRect(ctx, -10, -4, 18, 8, 3);
        ctx.fill();
        ctx.fillStyle = wd.color;
        ctx.beginPath();
        ctx.moveTo(8, -4);
        ctx.lineTo(14, 0);
        ctx.lineTo(8, 4);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffa94d';
        ctx.beginPath();
        ctx.arc(-12, 0, 5 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.6) this.fx.particles.push({ kind: 'smoke', x: x - Math.cos(a) * 14, y: y - Math.sin(a) * 14, vx: 0, vy: -10, life: 0.5, max: 0.5, size: 5, color: 'rgba(200,200,210,0.4)', g: 0, rot: 0, vr: 0, collide: false });
        break;
      }
      case 16: {
        // Мина
        ctx.fillStyle = '#495057';
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pr.stuck && Math.sin(this.time * 12) > 0 ? '#ff6b6b' : '#ffd43b';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 20: {
        // Диск-пила
        ctx.rotate(this.time * 30);
        ctx.fillStyle = wd.color;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          ctx.lineTo(Math.cos(ang) * size, Math.sin(ang) * size);
          ctx.lineTo(Math.cos(ang + 0.4) * size * 0.6, Math.sin(ang + 0.4) * size * 0.6);
        }
        ctx.fill();
        break;
      }
      case 26: {
        // Бумеранг
        ctx.rotate(this.time * 20);
        ctx.strokeStyle = wd.color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-size, -size * 0.6);
        ctx.lineTo(0, 0);
        ctx.lineTo(-size, size * 0.6);
        ctx.stroke();
        break;
      }
      case 11:
      case 21: {
        ctx.rotate(pr.stuck ? 0 : a);
        ctx.strokeStyle = pr.wid === 21 ? '#d9a066' : '#ced4da';
        ctx.lineWidth = pr.wid === 21 ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(-(pr.wid === 21 ? 16 : 8), 0);
        ctx.lineTo(4, 0);
        ctx.stroke();
        break;
      }
      case 23: {
        // Пузырь
        ctx.strokeStyle = 'rgba(153,233,242,0.9)';
        ctx.fillStyle = 'rgba(153,233,242,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(-size * 0.4, -size * 0.4, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 14: {
        // Морозное облачко
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#e3fafc';
        ctx.beginPath();
        ctx.arc(0, 0, size + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 19: {
        if (pr.active) break;
        ctx.fillStyle = wd.color;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e5dbff';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      default: {
        // Светящийся шар/болт
        ctx.globalCompositeOperation = 'lighter';
        const r = size * (pr.wid === 10 ? 1.6 + Math.sin(this.time * 20) * 0.2 : 1);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.5);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, wd.color);
        g.addColorStop(1, wd.color + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (pr.wid === 0 || pr.wid === 7 || pr.wid === 28) {
          ctx.rotate(a);
          ctx.fillStyle = wd.color;
          ctx.fillRect(-14, -1.5, 14, 3);
        }
      }
    }
    ctx.restore();
  }

  private drawEffects() {
    const ctx = this.ctx;
    const fx = this.fx;
    // Трассеры и лучи
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const t of fx.traces) {
      const f = t.life / t.max;
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = f;
      ctx.lineWidth = t.width * (t.kind === 'trace' ? f + 0.3 : 1);
      ctx.beginPath();
      if (t.kind === 'trace') {
        ctx.moveTo(t.pts[0], t.pts[1]);
        for (let i = 2; i < t.pts.length; i += 2) ctx.lineTo(t.pts[i], t.pts[i + 1]);
      } else {
        // Зигзаг молнии
        for (let i = 0; i + 3 < t.pts.length; i += 2) {
          const [x0, y0, x1, y1] = [t.pts[i], t.pts[i + 1], t.pts[i + 2], t.pts[i + 3]];
          const n = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 18));
          ctx.moveTo(x0, y0);
          for (let k = 1; k < n; k++) {
            const tt = k / n;
            ctx.lineTo(x0 + (x1 - x0) * tt + (Math.random() - 0.5) * 14, y0 + (y1 - y0) * tt + (Math.random() - 0.5) * 14);
          }
          ctx.lineTo(x1, y1);
        }
      }
      ctx.stroke();
      ctx.lineWidth *= 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Кольца взрывов
    for (const r of fx.rings) {
      const f = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - f;
      ctx.lineWidth = 6 * (1 - f) + 1;
      ctx.beginPath();
      if (r.dir !== undefined) ctx.arc(r.x, r.y, r.r * f, r.dir - 0.75, r.dir + 0.75);
      else ctx.arc(r.x, r.y, r.r * (0.3 + f * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Частицы
    for (const p of fx.particles) {
      const f = p.life / p.max;
      switch (p.kind) {
        case 'glow': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, `rgba(255,255,255,${f})`);
          g.addColorStop(0.4, p.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = f;
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          break;
        }
        case 'spark':
          ctx.globalAlpha = f;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case 'star':
          ctx.globalAlpha = f;
          ctx.fillStyle = p.color;
          star(ctx, p.x, p.y, p.size, p.rot);
          break;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of fx.particles) {
      const f = p.life / p.max;
      switch (p.kind) {
        case 'smoke':
          ctx.globalAlpha = f * 0.8;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'debris':
        case 'confetti':
        case 'bolt':
          ctx.globalAlpha = Math.min(1, f * 3);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.kind === 'confetti') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          else if (p.kind === 'bolt') {
            ctx.fillRect(-1.5, -4, 3, 8);
            ctx.fillRect(-3.5, -4, 7, 2.5);
          } else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          break;
        case 'snow':
          ctx.globalAlpha = f;
          ctx.fillStyle = p.color;
          star(ctx, p.x, p.y, p.size, p.rot);
          break;
      }
    }
    ctx.globalAlpha = 1;
    // Всплывающие числа
    ctx.textAlign = 'center';
    for (const t of fx.texts) {
      const f = t.life / t.max;
      ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = `900 ${t.size}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- HUD

  private drawHud(v: View) {
    const ctx = this.ctx;
    const me = v.me;
    const W = this.w;
    const H = this.h;
    const fx = this.fx;
    // «Компактный» HUD — для телефонов и низких экранов (в т.ч. телефон в альбомной ориентации).
    const small = W < 700 || H < 500;
    const touch = this.input.touchMode;

    if (fx.hurtFlash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,146,43,0)');
      g.addColorStop(1, `rgba(255,146,43,${fx.hurtFlash * 0.45})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Счёт и время
    const sorted = [...v.players.values()].sort((a, b) => b.frags - a.frags);
    ctx.textAlign = 'center';
    ctx.font = `800 ${small ? 16 : 20}px system-ui, sans-serif`;
    const tl = Math.max(0, Math.floor(v.timeLeft));
    const timeStr = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
    let top = timeStr;
    if (v.settings.mode === 'tdm') {
      const sc = [0, 0];
      for (const p of v.players.values()) if (p.team >= 0) sc[p.team] += p.frags;
      top = `${sc[0]}  ·  ${timeStr}  ·  ${sc[1]}`;
    }
    pill(ctx, W / 2, 22, top, '#fff');
    if (v.settings.mode === 'tdm') {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(W / 2 - 80, 36, 30, 3);
      ctx.fillStyle = '#4dabf7';
      ctx.fillRect(W / 2 + 50, 36, 30, 3);
    }
    if (me) {
      const place = sorted.indexOf(me) + 1;
      ctx.font = `700 ${small ? 11 : 14}px system-ui, sans-serif`;
      const limit = v.settings.mode === 'tdm' ? v.settings.fragLimit * 2 : v.settings.fragLimit;
      pill(ctx, W / 2, small ? 46 : 52, small ? `${place}/${sorted.length} · ${me.frags}/${limit}` : `Место ${place}/${sorted.length} · Выбито: ${me.frags} / ${limit}`, '#ced4da');
    }

    // Лента событий (на телефоне — только 3 последних, под кнопками оружия)
    ctx.textAlign = 'right';
    ctx.font = `600 ${small ? 10 : 13}px system-ui, sans-serif`;
    let fy = touch ? 120 : small ? 70 : 30;
    const feed = small ? fx.feed.slice(-3) : fx.feed;
    for (const f of feed) {
      ctx.globalAlpha = Math.min(1, f.t);
      const parts = f.killer ? [[f.killer, f.kc], [` ⟶ ${f.weapon} ⟶ `, '#adb5bd'], [f.victim, f.vc]] : [[f.victim, f.vc], [` (${f.weapon})`, '#adb5bd']];
      let x = W - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const total = parts.reduce((s, p) => s + ctx.measureText(p[0]).width, 0);
      ctx.fillRect(x - total - 8, fy - 13, total + 14, 19);
      for (let i = parts.length - 1; i >= 0; i--) {
        ctx.fillStyle = parts[i][1];
        ctx.fillText(parts[i][0], x, fy);
        x -= ctx.measureText(parts[i][0]).width;
      }
      fy += small ? 18 : 22;
    }
    ctx.globalAlpha = 1;

    // Сообщения
    ctx.textAlign = 'center';
    ctx.font = `800 ${small ? 13 : 18}px system-ui, sans-serif`;
    let my = H * (small ? 0.2 : 0.24);
    for (const m of small ? fx.messages.slice(-2) : fx.messages) {
      ctx.globalAlpha = Math.min(1, m.t);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(m.text, W / 2, my);
      ctx.fillStyle = '#ffe066';
      ctx.fillText(m.text, W / 2, my);
      my += 26;
    }
    ctx.globalAlpha = 1;

    this.drawMinimap(v);

    if (me) {
      if (me.alive) {
        // Здоровье и броня
        const bx = small ? 12 : 20;
        const by = H - (small ? 22 : 30);
        ctx.textAlign = 'left';
        ctx.font = `900 ${small ? 22 : 30}px system-ui, sans-serif`;
        ctx.fillStyle = me.hp > 60 ? '#69db7c' : me.hp > 30 ? '#ffd43b' : '#ff922b';
        ctx.fillText(`✚ ${Math.ceil(me.hp)}`, bx, by);
        ctx.fillStyle = '#74c0fc';
        ctx.fillText(`⛨ ${Math.ceil(me.armor)}`, bx + (small ? 90 : 125), by);
        // Активные усилители
        let px = bx;
        ctx.font = `700 ${small ? 11 : 13}px system-ui, sans-serif`;
        for (const pw of POWERS) {
          const t = me.powers[pw.kind];
          if (t <= 0) continue;
          ctx.fillStyle = pw.color;
          const label = `${pw.name} ${Math.ceil(t)}`;
          ctx.fillText(label, px, by - (small ? 30 : 40));
          px += ctx.measureText(label).width + 14;
        }

        // Оружие и патроны
        const wd = WEAPONS[me.weapon];
        const ammo = me.ammo[me.weapon];
        ctx.textAlign = 'right';
        ctx.font = `900 ${small ? 20 : 28}px system-ui, sans-serif`;
        ctx.fillStyle = wd.color;
        // На тач-экране справа внизу живёт стик прицела — сдвигаем патроны к центру.
        const ax = touch ? W * 0.62 : W - 20;
        ctx.fillText(ammo < 0 ? '∞' : String(ammo), ax, by);
        ctx.font = `700 ${small ? 12 : 15}px system-ui, sans-serif`;
        ctx.fillStyle = '#e9ecef';
        ctx.fillText(wd.name, ax, by - (small ? 24 : 32));

        // Полоса оружия
        if (!small && !touch) {
          const owned = WEAPONS.filter((w) => me.has(w.id));
          const slotW = small ? 30 : 38;
          let sx = W / 2 - (owned.length * slotW) / 2;
          const sy = H - (small ? 20 : 26);
          ctx.textAlign = 'center';
          ctx.font = `700 ${small ? 8 : 10}px system-ui, sans-serif`;
          owned.forEach((w, i) => {
            const cur = w.id === me.weapon;
            ctx.fillStyle = cur ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)';
            ctx.fillRect(sx + 1, sy - 14, slotW - 2, 20);
            if (cur) {
              ctx.fillStyle = w.color;
              ctx.fillRect(sx + 1, sy + 4, slotW - 2, 2);
            }
            ctx.fillStyle = me.ammo[w.id] === 0 ? '#666' : w.color;
            ctx.fillText(w.short, sx + slotW / 2, sy - 1);
            if (i < 10 && !this.input.touchMode) {
              ctx.fillStyle = '#868e96';
              ctx.fillText(String((i + 1) % 10), sx + slotW / 2, sy - 17);
            }
            sx += slotW;
          });
        }

        // Прицел
        if (!this.input.touchMode) {
          const cx = this.input.mouseX;
          const cy = this.input.mouseY;
          ctx.strokeStyle = fx.hitMarker > 0 ? '#ff922b' : 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          const g = 5 + fx.hitMarker * 6;
          ctx.moveTo(cx - g - 7, cy);
          ctx.lineTo(cx - g, cy);
          ctx.moveTo(cx + g, cy);
          ctx.lineTo(cx + g + 7, cy);
          ctx.moveTo(cx, cy - g - 7);
          ctx.lineTo(cx, cy - g);
          ctx.moveTo(cx, cy + g);
          ctx.lineTo(cx, cy + g + 7);
          ctx.stroke();
        } else {
          // Луч прицела для тача
          const s = this.worldToScreen(me.rx, me.ry - 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.setLineDash([6, 8]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(me.aim) * 40, s.y + Math.sin(me.aim) * 40);
          ctx.lineTo(s.x + Math.cos(me.aim) * 200, s.y + Math.sin(me.aim) * 200);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (v.phase === 'play') {
        ctx.textAlign = 'center';
        ctx.font = `900 ${small ? 26 : 36}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        const txt = `Возвращение через ${Math.max(0, me.respawn).toFixed(1)}`;
        ctx.strokeText(txt, W / 2, H / 2);
        ctx.fillText(txt, W / 2, H / 2);
      }
    }

    if (this.input.touchMode) this.drawTouch();
    if (this.input.showScores || v.phase === 'end') this.drawScores(v, sorted);
    if (v.ping > 0) {
      ctx.textAlign = 'left';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = v.ping < 80 ? '#69db7c' : v.ping < 160 ? '#ffd43b' : '#ff922b';
      ctx.fillText(`пинг ${Math.round(v.ping)} мс`, small ? 64 : 12, small ? H - 8 : 140);
    }
  }

  private drawMinimap(v: View) {
    const ctx = this.ctx;
    const small = this.w < 700 || this.h < 500;
    const s = small ? 1.1 : 2;
    const mw = v.map.w * s;
    const mh = v.map.h * s;
    // Слева сверху — кнопка меню (Angular-оверлей), мини-карта правее неё.
    const x0 = 56;
    const y0 = small ? 8 : 10;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6);
    if (!this.mini || this.miniMap !== v.map || this.miniVersion !== v.map.version) {
      this.mini ??= document.createElement('canvas');
      this.mini.width = v.map.w;
      this.mini.height = v.map.h;
      const mc = this.mini.getContext('2d')!;
      mc.clearRect(0, 0, v.map.w, v.map.h);
      mc.fillStyle = 'rgba(255,255,255,0.35)';
      for (let cy = 0; cy < v.map.h; cy++) {
        for (let cx = 0; cx < v.map.w; cx++) if (v.map.isStandable(cx, cy)) mc.fillRect(cx, cy, 1, 1);
      }
      this.miniMap = v.map;
      this.miniVersion = v.map.version;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mini, x0, y0, mw, mh);
    ctx.imageSmoothingEnabled = true;
    for (const p of v.players.values()) {
      if (!p.alive) continue;
      const enemy = v.me && p !== v.me && (v.settings.mode !== 'tdm' || p.team !== v.me.team);
      ctx.fillStyle = p === v.me ? '#ffd43b' : enemy ? p.color : '#8ce99a';
      const r = p === v.me ? 3 : 2.2;
      ctx.beginPath();
      ctx.arc(x0 + (p.rx / TILE) * s, y0 + (p.ry / TILE) * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTouch() {
    const ctx = this.ctx;
    const inp = this.input;
    for (const st of [inp.left, inp.right]) {
      if (!st) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, 60, 0, Math.PI * 2);
      ctx.stroke();
      const v = inp.stickVec(st);
      const l = Math.min(1, v.len);
      const ang = Math.atan2(v.y, v.x);
      ctx.fillStyle = st === inp.right && v.len > 0.55 ? 'rgba(255,146,43,0.6)' : 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(st.ox + Math.cos(ang) * l * 60, st.oy + Math.sin(ang) * l * 60, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!inp.left) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('← движение →', this.w * 0.2, this.h - 40);
    }
    if (!inp.right) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillText('прицел / огонь', this.w * 0.72, this.h - 40);
    }
    for (const b of inp.buttons) {
      ctx.fillStyle = b.down ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${b.r * 0.8}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x, b.y + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawScores(v: View, sorted: Player[]) {
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    const rows = sorted.length;
    const bw = Math.min(520, W - 30);
    const bh = 90 + rows * 28;
    const x = (W - bw) / 2;
    const y = Math.max(70, (H - bh) / 2);
    ctx.fillStyle = 'rgba(10,14,28,0.85)';
    roundRect(ctx, x, y, bw, bh, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.fillStyle = '#ffe066';
    const title = v.phase === 'end' ? `Победа: ${this.fx.winner || '—'}!` : 'Таблица';
    ctx.fillText(title, W / 2, y + 34);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#868e96';
    ctx.textAlign = 'left';
    ctx.fillText('Игрок', x + 20, y + 62);
    ctx.textAlign = 'right';
    ctx.fillText('Выбил', x + bw - 120, y + 62);
    ctx.fillText('Выбыл', x + bw - 60, y + 62);
    ctx.fillText('Пинг', x + bw - 14, y + 62);
    sorted.forEach((p, i) => {
      const ry = y + 88 + i * 28;
      if (p === v.me) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 8, ry - 18, bw - 16, 26);
      }
      ctx.textAlign = 'left';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillStyle = p.color;
      ctx.fillText(`${i + 1}. ${p.name}${p.isBot ? ' 🤖' : ''}`, x + 20, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(p.frags), x + bw - 120, ry);
      ctx.fillStyle = '#adb5bd';
      ctx.fillText(String(p.deaths), x + bw - 60, ry);
      ctx.fillText(p.isBot ? '—' : String(Math.round(p.ping)), x + bw - 14, ry);
    });
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function pill(c: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  const w = c.measureText(text).width + 22;
  c.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(c, x - w / 2, y - 16, w, 24, 12);
  c.fill();
  c.fillStyle = color;
  c.fillText(text, x, y + 2);
}
