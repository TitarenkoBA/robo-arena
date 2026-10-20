import { COLORS, PHYS, TEAM_COLORS, TILE } from './constants';
import { Bot } from './bot';
import { ParsedMap, mapById, parseMap } from './maps';
import { clamp, dist2, pick, rand, segmentAabb } from './math';
import { applyImpulse, stepMovement } from './physics';
import { T, TILE_INFO, TileMap, moveBox } from './tiles';
import {
  GameEvent, GameSettings, ITEM_RESPAWN, Input, Item, PROP_INFO, Player, Projectile, Prop, RosterEntry,
} from './types';
import { ExplodeDef, POWERS, SPAWN_POOL, WEAPONS, WeaponDef } from './weapons';

const BARREL_BOOM: ExplodeDef = { radius: 140, damage: 80, knock: 1100, tileDamage: 160 };
/** Специальный id «оружия» для бочки и падения в пропасть — для ленты событий. */
export const WID_BARREL = 100;
export const WID_FALL = 101;

interface SpawnedProp {
  home: number;
  timer: number;
}

export class World {
  parsed!: ParsedMap;
  map!: TileMap;
  readonly players = new Map<number, Player>();
  projectiles: Projectile[] = [];
  props: Prop[] = [];
  items: Item[] = [];
  events: GameEvent[] = [];
  readonly bots = new Map<number, Bot>();
  time = 0;
  timeLeft = 0;
  phase: 'play' | 'end' = 'play';
  endTimer = 0;
  winner = '';
  /** Увеличивается при перезапуске матча (нужно заново разослать карту). */
  generation = 0;
  rosterDirty = true;

  private nextPlayerId = 1;
  private nextProjId = 1;
  private nextPropId = 1;
  private propRespawns: SpawnedProp[] = [];

  constructor(public settings: GameSettings) {
    this.loadMap();
  }

  // ------------------------------------------------------------------ матч

  private loadMap() {
    this.parsed = parseMap(mapById(this.settings.mapId));
    this.map = this.parsed.tiles;
    this.projectiles = [];
    this.props = [];
    this.propRespawns = [];
    this.parsed.props.forEach((_, i) => this.spawnProp(i));
    const pool = [...SPAWN_POOL].sort(() => Math.random() - 0.5);
    let wi = 0;
    this.items = this.parsed.items.map((it, i) => ({
      id: i,
      kind: it.kind,
      x: it.x,
      y: it.y,
      active: it.kind !== 'power',
      timer: it.kind === 'power' ? 20 : 0,
      sub: it.kind === 'weapon' ? pool[wi++ % pool.length] : it.kind === 'power' ? Math.floor(Math.random() * POWERS.length) : 0,
    }));
    this.timeLeft = this.settings.timeLimit * 60;
    this.phase = 'play';
    this.generation++;
  }

  restart() {
    this.loadMap();
    for (const p of this.players.values()) {
      p.frags = 0;
      p.deaths = 0;
      p.streak = 0;
      p.alive = false;
      p.respawn = 0.3;
    }
    this.rosterDirty = true;
    this.emit({ k: 'msg', text: 'Новый раунд!' });
  }

  addPlayer(name: string, color: string, isBot: boolean): Player {
    const id = this.nextPlayerId++;
    const names = new Set([...this.players.values()].map((p) => p.name));
    if (names.has(name)) {
      let n = 2;
      while (names.has(`${name} ${n}`)) n++;
      name = `${name} ${n}`;
    }
    let team = -1;
    if (this.settings.mode === 'tdm') {
      let red = 0;
      let blue = 0;
      for (const p of this.players.values()) p.team === 0 ? red++ : blue++;
      team = red <= blue ? 0 : 1;
    }
    const used = new Set([...this.players.values()].map((p) => p.color));
    const c = used.has(color) ? COLORS.find((x) => !used.has(x)) ?? color : color;
    const p = new Player(id, name, team >= 0 ? TEAM_COLORS[team] : c, team, isBot);
    p.alive = false;
    p.respawn = 0.2;
    this.players.set(id, p);
    if (isBot) this.bots.set(id, new Bot(this.settings.botSkill));
    this.rosterDirty = true;
    this.emit({ k: 'msg', text: `${name} в игре` });
    return p;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.bots.delete(id);
    this.rosterDirty = true;
    this.emit({ k: 'msg', text: `${p.name} вышел` });
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, frags: p.frags, deaths: p.deaths, bot: p.isBot, ping: p.ping,
    }));
  }

  emit(e: GameEvent) {
    this.events.push(e);
  }

  // ------------------------------------------------------------------ шаг симуляции

  step(dt: number) {
    this.time += dt;
    if (this.phase === 'end') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.restart();
      return;
    }
    this.timeLeft -= dt;

    for (const [id, bot] of this.bots) {
      const p = this.players.get(id);
      if (p) p.inputQueue.push(bot.think(this, p, dt));
    }

    for (const p of this.players.values()) this.stepPlayer(p, dt);
    this.stepProjectiles(dt);
    this.stepProps(dt);
    this.stepItems(dt);
    this.checkEnd();
  }

  private consumeInput(p: Player): Input {
    // Одна команда на тик; если очередь разрослась (лаг) — догоняем.
    while (p.inputQueue.length > 3) p.inputQueue.shift();
    const next = p.inputQueue.shift();
    if (next) {
      p.lastAck = next.seq;
      p.input = next;
    }
    return p.input;
  }

  private stepPlayer(p: Player, dt: number) {
    const inp = this.consumeInput(p);
    if (!p.alive) {
      p.respawn -= dt;
      if (p.respawn <= 0) this.respawn(p);
      return;
    }
    // Таймеры
    for (const k of Object.keys(p.powers) as (keyof typeof p.powers)[]) p.powers[k] = Math.max(0, p.powers[k] - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.bubble = Math.max(0, p.bubble - dt);
    p.spawnShield = Math.max(0, p.spawnShield - dt);
    if (p.hp > PHYS.maxHealth) p.hp = Math.max(PHYS.maxHealth, p.hp - dt * 2);
    if (p.armor > 100) p.armor = Math.max(100, p.armor - dt * 2);
    if (p.powers.regen > 0 && p.hp < PHYS.overHealth) p.hp = Math.min(PHYS.overHealth, p.hp + dt * 12);

    stepMovement(p, inp, this.map, this.props, dt, true, (t, pl) =>
      this.emit({ k: 'jump', p: pl.id, x: pl.x | 0, y: (pl.y + pl.h / 2) | 0, t }),
    );

    // Смена оружия: применяется только при изменении запроса,
    // чтобы автосмена при подборе не откатывалась старым вводом клиента.
    if (inp.w !== p.lastReqW) {
      if (p.has(inp.w) && inp.w !== p.weapon) {
        p.weapon = inp.w;
        p.cooldown = Math.max(p.cooldown, 0.12);
        p.spin = 0;
      }
      p.lastReqW = inp.w;
    }

    this.stepWeapon(p, inp, dt);

    if (p.y > this.map.pxH + 300) {
      const credit = this.time - p.lastHitTime < 4 ? p.lastHitBy : -1;
      this.kill(p, credit, WID_FALL);
    }
  }

  private respawn(p: Player) {
    const spawns = this.parsed.spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 1e12;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        minD = Math.min(minD, dist2(s.x, s.y, o.x, o.y));
      }
      const score = Math.sqrt(minD) + rand(0, 400);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    p.resetLoadout();
    p.x = best.x;
    p.y = best.y - 6;
    p.rx = p.x;
    p.ry = p.y;
    p.vx = 0;
    p.vy = 0;
    p.alive = true;
    p.spawnShield = PHYS.spawnShield;
    p.lastHitBy = -1;
    this.emit({ k: 'spawn', p: p.id, x: p.x | 0, y: p.y | 0 });
  }

  // ------------------------------------------------------------------ урон

  damage(t: Player, amount: number, attacker: number, wid: number, kx: number, ky: number) {
    if (!t.alive) return;
    const a = this.players.get(attacker);
    const sameTeam = !!a && a !== t && this.settings.mode === 'tdm' && a.team === t.team;
    applyImpulse(t, kx, ky);
    if (t.spawnShield > 0) return;
    if (sameTeam && !this.settings.friendlyFire) return;
    if (a === t) amount *= 0.4;
    if (t.powers.shield > 0) amount *= 0.33;
    if (amount <= 0) return;
    const save = Math.min(t.armor, amount * 0.66);
    t.armor -= save;
    t.hp -= amount - save;
    t.hurt = 1;
    if (a && a !== t) {
      t.lastHitBy = attacker;
      t.lastHitTime = this.time;
    }
    this.emit({ k: 'hit', p: t.id, x: t.x | 0, y: (t.y - 10) | 0, d: Math.round(amount) });
    if (t.hp <= 0) this.kill(t, attacker, wid);
  }

  kill(v: Player, attacker: number, wid: number) {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.respawn = PHYS.respawnTime;
    v.deaths++;
    v.streak = 0;
    v.bubble = 0;
    const a = this.players.get(attacker);
    if (a && a !== v) {
      a.frags++;
      a.streak++;
      if (a.streak === 3) this.emit({ k: 'msg', text: `${a.name}: серия из трёх!` });
      if (a.streak === 5) this.emit({ k: 'msg', text: `${a.name} неудержим!` });
      if (a.streak === 8) this.emit({ k: 'msg', text: `${a.name} — ЛЕГЕНДА!` });
    } else {
      v.frags--;
    }
    this.emit({ k: 'pop', p: v.id, x: v.x | 0, y: v.y | 0, c: v.color });
    this.emit({ k: 'kill', a: a ? a.id : -1, v: v.id, w: wid });
    this.rosterDirty = true;
  }

  private damageProp(o: Prop, amount: number, attacker: number, kx: number, ky: number) {
    o.vx += kx / o.mass;
    o.vy += ky / o.mass;
    o.hp -= amount;
    o.lastHitBy = attacker;
    if (o.hp <= 0) this.destroyProp(o);
  }

  private destroyProp(o: Prop) {
    const idx = this.props.indexOf(o);
    if (idx < 0) return;
    this.props.splice(idx, 1);
    this.emit({ k: 'prop', id: o.id, x: o.x | 0, y: o.y | 0, kind: o.kind });
    const home = this.parsed.props[o.home];
    if (home) this.propRespawns.push({ home: o.home, timer: 25 });
    if (o.kind === 'barrel') this.explode(o.x, o.y, BARREL_BOOM, o.lastHitBy, WID_BARREL, 1);
  }

  private damageTile(cx: number, cy: number, amount: number) {
    if (amount <= 0) return;
    const before = this.map.get(cx, cy);
    const r = this.map.damage(cx, cy, amount);
    const i = this.map.idx(cx, cy);
    if (r === 'destroyed') this.emit({ k: 'tile', i, v: T.EMPTY, t: before });
    else if (r === 'cracked') this.emit({ k: 'crack', i, l: this.map.crack[i] });
  }

  explode(x: number, y: number, ex: ExplodeDef, owner: number, wid: number, mult: number) {
    this.emit({ k: 'boom', x: x | 0, y: y | 0, r: ex.radius, w: wid });
    const r = ex.radius;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const cx = clamp(x, p.x - p.w / 2, p.x + p.w / 2);
      const cy = clamp(y, p.y - p.h / 2, p.y + p.h / 2);
      const d = Math.sqrt(dist2(x, y, cx, cy));
      if (d > r) continue;
      if (!this.map.lineOfSight(x, y, p.x, p.y) && !this.map.lineOfSight(x, y - 4, p.x, p.y - p.h / 2)) continue;
      const f = 1 - d / r;
      let dx = p.x - x;
      let dy = p.y - y - 8;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const self = p.id === owner;
      const k = ex.knock * (0.35 + 0.65 * f) * (self ? 1.15 : 1);
      this.damage(p, ex.damage * f * mult, owner, wid, dx * k, dy * k);
    }
    for (const o of [...this.props]) {
      const d = Math.sqrt(dist2(x, y, o.x, o.y));
      if (d > r + o.w / 2) continue;
      const f = clamp(1 - d / r, 0.1, 1);
      const len = d || 1;
      this.damageProp(o, ex.damage * f * mult, owner, ((o.x - x) / len) * ex.knock * f, ((o.y - y - 10) / len) * ex.knock * f);
    }
    if (ex.tileDamage) {
      const c0 = Math.floor((x - r) / TILE);
      const c1 = Math.floor((x + r) / TILE);
      const r0 = Math.floor((y - r) / TILE);
      const r1 = Math.floor((y + r) / TILE);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const d = Math.sqrt(dist2(x, y, cx * TILE + TILE / 2, cy * TILE + TILE / 2));
          if (d < r * 0.8) this.damageTile(cx, cy, ex.tileDamage * (1 - d / r));
        }
      }
    }
    // Детонация мин рядом
    for (const pr of this.projectiles) {
      const def = WEAPONS[pr.wid].proj;
      if (def?.mine && dist2(pr.x, pr.y, x, y) < r * r) pr.life = Math.min(pr.life, pr.age + 0.05);
    }
  }

  // ------------------------------------------------------------------ оружие

  private stepWeapon(p: Player, inp: Input, dt: number) {
    const wd = WEAPONS[p.weapon];
    const rate = p.powers.haste > 0 ? 1.3 : 1;
    p.cooldown -= dt * rate;
    p.muzzle = Math.max(0, p.muzzle - dt);
    if (wd.spinup) p.spin = inp.fire ? Math.min(1, p.spin + dt / wd.spinup) : Math.max(0, p.spin - dt);
    if (p.bubble > 0 || !inp.fire || p.cooldown > 0) return;
    if (wd.spinup && p.spin < 0.35) return;
    const ammo = p.ammo[p.weapon];
    if (ammo === 0) {
      this.switchToBest(p);
      return;
    }
    if (ammo > 0) p.ammo[p.weapon]--;
    p.cooldown = wd.spinup ? wd.cooldown / (0.3 + 0.7 * p.spin) : wd.cooldown;
    p.muzzle = 0.06;
    const mult = p.powers.quad > 0 ? 3 : 1;
    const a = inp.aim;
    const sx = p.x;
    const sy = p.y - 6;
    let mx = sx + Math.cos(a) * 24;
    let my = sy + Math.sin(a) * 24;
    const block = this.map.raycast(sx, sy, mx, my);
    if (block) {
      mx = sx + (block.x - sx) * 0.9;
      my = sy + (block.y - sy) * 0.9;
    }
    if (wd.kind !== 'beam') this.emit({ k: 'shot', p: p.id, w: wd.id, x: mx | 0, y: my | 0, a: Math.round(a * 100) / 100 });

    switch (wd.kind) {
      case 'projectile': {
        const n = wd.pellets ?? 1;
        for (let i = 0; i < n; i++) {
          const ang = a + (wd.spread ? rand(-wd.spread, wd.spread) : 0);
          this.spawnProjectile(wd.id, p, mx, my, ang, wd.proj!.speed, mult);
        }
        break;
      }
      case 'hitscan': {
        const n = wd.pellets ?? 1;
        for (let i = 0; i < n; i++) {
          const ang = a + (wd.spread ? rand(-wd.spread, wd.spread) : 0);
          this.hitscan(p, wd, mx, my, ang, mult);
        }
        break;
      }
      case 'beam':
        this.beam(p, wd, mx, my, a, mult);
        break;
      case 'melee':
        this.melee(p, wd, a, mult);
        break;
      case 'wave':
        this.wave(p, wd, a, mult);
        break;
      case 'chain':
        this.chain(p, wd, mx, my, a, mult);
        break;
    }
    if (wd.recoil) applyImpulse(p, -Math.cos(a) * wd.recoil, -Math.sin(a) * wd.recoil);
  }

  switchToBest(p: Player) {
    let best = 0;
    let score = -1;
    for (const w of WEAPONS) {
      if (!p.has(w.id) || p.ammo[w.id] === 0) continue;
      if (w.botScore > score) {
        score = w.botScore;
        best = w.id;
      }
    }
    p.weapon = best;
  }

  spawnProjectile(wid: number, owner: Player | null, x: number, y: number, ang: number, speed: number, mult: number) {
    const def = WEAPONS[wid].proj!;
    const pr: Projectile = {
      id: this.nextProjId++,
      wid,
      owner: owner ? owner.id : -1,
      team: owner ? owner.team : -1,
      x,
      y,
      vx: Math.cos(ang) * speed + (owner ? owner.vx * 0.15 : 0),
      vy: Math.sin(ang) * speed + (owner ? owner.vy * 0.1 : 0),
      age: 0,
      life: def.life * (def.fuse ? rand(0.9, 1.1) : 1),
      bounces: 0,
      stuck: false,
      mult,
      hit: [],
      active: 0,
      rx: x,
      ry: y,
      ox: x,
      oy: y,
    };
    this.projectiles.push(pr);
    return pr;
  }

  /** Ближайшее попадание по игрокам/ящикам на отрезке. */
  private traceEntities(
    x0: number, y0: number, x1: number, y1: number, pad: number, skip: (p: Player) => boolean,
  ): { t: number; p?: Player; o?: Prop } | null {
    let best: { t: number; p?: Player; o?: Prop } | null = null;
    for (const p of this.players.values()) {
      if (!p.alive || skip(p)) continue;
      const t = segmentAabb(x0, y0, x1, y1, p.x - p.w / 2 - pad, p.y - p.h / 2 - pad, p.w + pad * 2, p.h + pad * 2);
      if (t >= 0 && (!best || t < best.t)) best = { t, p };
    }
    for (const o of this.props) {
      const t = segmentAabb(x0, y0, x1, y1, o.x - o.w / 2 - pad, o.y - o.h / 2 - pad, o.w + pad * 2, o.h + pad * 2);
      if (t >= 0 && (!best || t < best.t)) best = { t, o };
    }
    return best;
  }

  private hitscan(p: Player, wd: WeaponDef, x0: number, y0: number, ang: number, mult: number) {
    const pts = [x0 | 0, y0 | 0];
    let dx = Math.cos(ang);
    let dy = Math.sin(ang);
    let range = wd.range ?? 2000;
    let reflects = wd.reflect ?? 0;
    let pierce = wd.pierce ?? 1;
    const hitIds = new Set<number>();
    let ignoreOwner = true;
    for (let seg = 0; seg < 8 && range > 0; seg++) {
      const x1 = x0 + dx * range;
      const y1 = y0 + dy * range;
      const wall = this.map.raycast(x0, y0, x1, y1);
      const wallT = wall ? wall.t : 1;
      // Все цели на отрезке до стены, по порядку.
      const targets: { t: number; p?: Player; o?: Prop }[] = [];
      for (const pl of this.players.values()) {
        if (!pl.alive || hitIds.has(pl.id) || (ignoreOwner && pl === p)) continue;
        const t = segmentAabb(x0, y0, x1, y1, pl.x - pl.w / 2, pl.y - pl.h / 2, pl.w, pl.h);
        if (t >= 0 && t < wallT) targets.push({ t, p: pl });
      }
      for (const o of this.props) {
        const t = segmentAabb(x0, y0, x1, y1, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
        if (t >= 0 && t < wallT) targets.push({ t, o });
      }
      targets.sort((a, b) => a.t - b.t);
      let stopT = wallT;
      let stopped = false;
      for (const tg of targets) {
        const hx = x0 + (x1 - x0) * tg.t;
        const hy = y0 + (y1 - y0) * tg.t;
        const k = wd.knock ?? 0;
        if (tg.p) {
          hitIds.add(tg.p.id);
          this.damage(tg.p, wd.damage * mult, p.id, wd.id, dx * k, dy * k);
          if (wd.freeze) tg.p.slow = wd.freeze;
        } else if (tg.o) {
          this.damageProp(tg.o, wd.damage * mult, p.id, dx * k, dy * k);
          this.emit({ k: 'wall', x: hx | 0, y: hy | 0, c: PROP_INFO[tg.o.kind].edge });
        }
        pierce--;
        if (pierce <= 0) {
          stopT = tg.t;
          stopped = true;
          break;
        }
      }
      const ex = x0 + (x1 - x0) * stopT;
      const ey = y0 + (y1 - y0) * stopT;
      pts.push(ex | 0, ey | 0);
      if (stopped) break;
      if (!wall) break;
      this.damageTile(wall.cx, wall.cy, (wd.tileDamage ?? 0) * mult);
      this.emit({ k: 'wall', x: ex | 0, y: ey | 0, c: TILE_INFO[wall.tile]?.debris || '#fff' });
      if (reflects <= 0) break;
      reflects--;
      range -= range * stopT;
      if (wall.nx !== 0) dx = -dx;
      if (wall.ny !== 0) dy = -dy;
      x0 = ex + wall.nx * 0.5;
      y0 = ey + wall.ny * 0.5;
      ignoreOwner = false;
    }
    this.emit({ k: 'trace', w: wd.id, pts });
  }

  private beam(p: Player, wd: WeaponDef, x0: number, y0: number, ang: number, mult: number) {
    const range = wd.range ?? 400;
    let x1 = x0 + Math.cos(ang) * range;
    let y1 = y0 + Math.sin(ang) * range;
    const wall = this.map.raycast(x0, y0, x1, y1);
    const wallT = wall ? wall.t : 1;
    const ent = this.traceEntities(x0, y0, x1, y1, 4, (o) => o === p);
    const k = wd.knock ?? 0;
    if (ent && ent.t < wallT) {
      x1 = x0 + (x1 - x0) * ent.t;
      y1 = y0 + (y1 - y0) * ent.t;
      if (ent.p) this.damage(ent.p, wd.damage * mult, p.id, wd.id, Math.cos(ang) * k, Math.sin(ang) * k);
      if (ent.o) this.damageProp(ent.o, wd.damage * mult, p.id, Math.cos(ang) * k, Math.sin(ang) * k);
    } else if (wall) {
      x1 = wall.x;
      y1 = wall.y;
      this.damageTile(wall.cx, wall.cy, (wd.tileDamage ?? 0) * mult);
    }
    this.emit({ k: 'beam', p: p.id, w: wd.id, x: x0 | 0, y: y0 | 0, x2: x1 | 0, y2: y1 | 0 });
  }

  private melee(p: Player, wd: WeaponDef, ang: number, mult: number) {
    const range = wd.range ?? 60;
    const hx = p.x + Math.cos(ang) * range * 0.6;
    const hy = p.y - 6 + Math.sin(ang) * range * 0.6;
    const k = wd.knock ?? 0;
    let hitSomething = false;
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      if (Math.abs(o.x - hx) < range * 0.6 + o.w / 2 && Math.abs(o.y - hy) < range * 0.6 + o.h / 2) {
        this.damage(o, wd.damage * mult, p.id, wd.id, Math.cos(ang) * k, Math.sin(ang) * k - 250);
        hitSomething = true;
      }
    }
    for (const o of [...this.props]) {
      if (Math.abs(o.x - hx) < range * 0.6 + o.w / 2 && Math.abs(o.y - hy) < range * 0.6 + o.h / 2) {
        this.damageProp(o, wd.damage * mult, p.id, Math.cos(ang) * k, Math.sin(ang) * k - 200);
        hitSomething = true;
      }
    }
    const tx = Math.floor((p.x + Math.cos(ang) * range * 0.8) / TILE);
    const ty = Math.floor((p.y - 6 + Math.sin(ang) * range * 0.8) / TILE);
    if (this.map.isSolid(tx, ty)) {
      this.damageTile(tx, ty, (wd.tileDamage ?? 0) * mult);
      hitSomething = true;
    }
    if (hitSomething) this.emit({ k: 'wall', x: hx | 0, y: hy | 0, c: '#ffcc66' });
  }

  private wave(p: Player, wd: WeaponDef, ang: number, mult: number) {
    const range = wd.range ?? 240;
    const cone = 0.75;
    const k = wd.knock ?? 0;
    const inCone = (x: number, y: number) => {
      const dx = x - p.x;
      const dy = y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1) return 0;
      let da = Math.atan2(dy, dx) - ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      return Math.abs(da) < cone ? 1 - d / range : 0;
    };
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      const f = inCone(o.x, o.y);
      if (f <= 0) continue;
      const a = Math.atan2(o.y - p.y, o.x - p.x);
      this.damage(o, wd.damage * mult * (0.5 + f * 0.5), p.id, wd.id, Math.cos(a) * k * (0.5 + f), Math.sin(a) * k * (0.5 + f) - 200);
    }
    for (const o of [...this.props]) {
      const f = inCone(o.x, o.y);
      if (f <= 0) continue;
      const a = Math.atan2(o.y - p.y, o.x - p.x);
      this.damageProp(o, wd.damage * mult * 0.5, p.id, Math.cos(a) * k, Math.sin(a) * k - 200);
    }
    // Отражаем вражеские снаряды!
    for (const pr of this.projectiles) {
      if (pr.owner === p.id || pr.stuck || inCone(pr.x, pr.y) <= 0) continue;
      const sp = Math.hypot(pr.vx, pr.vy) * 1.2 + 200;
      const a = Math.atan2(pr.y - p.y, pr.x - p.x);
      pr.vx = Math.cos(a) * sp;
      pr.vy = Math.sin(a) * sp;
      pr.owner = p.id;
      pr.team = p.team;
      pr.hit = [];
    }
    // Хрупкие тайлы в конусе
    for (let r = 1; r <= 6; r++) {
      for (let s = -2; s <= 2; s++) {
        const a = ang + s * 0.3;
        const x = p.x + Math.cos(a) * r * (range / 6);
        const y = p.y + Math.sin(a) * r * (range / 6);
        const cx = Math.floor(x / TILE);
        const cy = Math.floor(y / TILE);
        const t = this.map.get(cx, cy);
        if (t === T.GLASS || t === T.WOOD) this.damageTile(cx, cy, (wd.tileDamage ?? 0) * mult);
      }
    }
    this.emit({ k: 'vortex', x: p.x | 0, y: p.y | 0, r: -range, d: Math.round(ang * 100) / 100 });
  }

  private chain(p: Player, wd: WeaponDef, x0: number, y0: number, ang: number, mult: number) {
    const range = wd.range ?? 350;
    const jumps = wd.chain?.jumps ?? 2;
    const jr = wd.chain?.radius ?? 200;
    const pts = [x0 | 0, y0 | 0];
    const hit = new Set<number>([p.id]);
    let cx = x0;
    let cy = y0;
    let first = true;
    for (let j = 0; j <= jumps; j++) {
      let best: Player | null = null;
      let bestD = Infinity;
      for (const o of this.players.values()) {
        if (!o.alive || hit.has(o.id)) continue;
        if (this.settings.mode === 'tdm' && o.team === p.team && !this.settings.friendlyFire) continue;
        const d = Math.hypot(o.x - cx, o.y - cy);
        if (d > (first ? range : jr)) continue;
        if (first) {
          let da = Math.atan2(o.y - cy, o.x - cx) - ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) > 0.6) continue;
        }
        if (!this.map.lineOfSight(cx, cy, o.x, o.y)) continue;
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) break;
      hit.add(best.id);
      const k = wd.knock ?? 0;
      const a = Math.atan2(best.y - cy, best.x - cx);
      this.damage(best, wd.damage * mult * (first ? 1 : 0.8), p.id, wd.id, Math.cos(a) * k, Math.sin(a) * k);
      pts.push(best.x | 0, best.y | 0);
      cx = best.x;
      cy = best.y;
      first = false;
    }
    if (pts.length === 2) {
      // Промах — короткая искра в сторону прицела.
      const w = this.map.raycast(x0, y0, x0 + Math.cos(ang) * range * 0.6, y0 + Math.sin(ang) * range * 0.6);
      pts.push(w ? w.x | 0 : (x0 + Math.cos(ang) * range * 0.6) | 0, w ? w.y | 0 : (y0 + Math.sin(ang) * range * 0.6) | 0);
    }
    this.emit({ k: 'chain', pts });
  }

  // ------------------------------------------------------------------ снаряды

  private stepProjectiles(dt: number) {
    const remove = new Set<Projectile>();
    const add: (() => void)[] = [];
    for (const pr of this.projectiles) {
      const wd = WEAPONS[pr.wid];
      const def = wd.proj!;
      pr.age += dt;

      // Воронка гравитона
      if (pr.active > 0) {
        pr.active -= dt;
        this.applyVortex(pr, dt);
        if (pr.active <= 0) {
          if (def.explode) this.explode(pr.x, pr.y, def.explode, pr.owner, pr.wid, pr.mult);
          remove.add(pr);
        }
        continue;
      }

      if (pr.age >= pr.life) {
        this.projectileExpire(pr, add);
        if (pr.active <= 0) remove.add(pr);
        continue;
      }

      if (pr.stuck) {
        if (def.mine && pr.age > def.mine.arm) {
          for (const p of this.players.values()) {
            if (!p.alive || (p.id === pr.owner && pr.age < 3)) continue;
            if (this.settings.mode === 'tdm' && p.team === pr.team && p.id !== pr.owner) continue;
            if (dist2(p.x, p.y, pr.x, pr.y) < def.mine.trigger * def.mine.trigger) {
              pr.life = pr.age;
              break;
            }
          }
        }
        continue;
      }

      // Самонаведение
      if (def.homing) {
        const tgt = this.nearestEnemy(pr.x, pr.y, pr.owner, pr.team, 900, Math.atan2(pr.vy, pr.vx), 1.2);
        if (tgt) {
          const cur = Math.atan2(pr.vy, pr.vx);
          let want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x) - cur;
          while (want > Math.PI) want -= Math.PI * 2;
          while (want < -Math.PI) want += Math.PI * 2;
          const turn = clamp(want, -def.homing * dt, def.homing * dt);
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(cur + turn) * sp;
          pr.vy = Math.sin(cur + turn) * sp;
        }
      }
      // Бумеранг возвращается
      if (def.boomerang && pr.age > 0.35) {
        const o = this.players.get(pr.owner);
        if (o && o.alive) {
          const dx = o.x - pr.x;
          const dy = o.y - pr.y;
          const d = Math.hypot(dx, dy) || 1;
          pr.vx += (dx / d) * 3200 * dt;
          pr.vy += (dy / d) * 3200 * dt;
          const sp = Math.hypot(pr.vx, pr.vy);
          if (sp > 1150) {
            pr.vx *= 1150 / sp;
            pr.vy *= 1150 / sp;
          }
          if (d < 26 && pr.age > 0.6) {
            remove.add(pr);
            continue;
          }
        }
      }
      // Молнии БФГ
      if (def.zap) {
        for (const p of this.players.values()) {
          if (!p.alive || p.id === pr.owner) continue;
          if (this.settings.mode === 'tdm' && p.team === pr.team && !this.settings.friendlyFire) continue;
          if (dist2(p.x, p.y, pr.x, pr.y) > def.zap.radius * def.zap.radius) continue;
          if (!this.map.lineOfSight(pr.x, pr.y, p.x, p.y)) continue;
          this.damage(p, def.zap.dps * dt * pr.mult, pr.owner, pr.wid, 0, 0);
          if (Math.random() < 0.25) this.emit({ k: 'chain', pts: [pr.x | 0, pr.y | 0, p.x | 0, p.y | 0] });
        }
      }

      if (def.drag) {
        pr.vx *= 1 - def.drag * dt;
        pr.vy *= 1 - def.drag * dt;
      }
      pr.vy += PHYS.gravity * def.gravity * dt;

      const x1 = pr.x + pr.vx * dt;
      const y1 = pr.y + pr.vy * dt;
      const wall = this.map.raycast(pr.x, pr.y, x1, y1);
      const wallT = wall ? wall.t : 1;
      const ent = this.traceEntities(pr.x, pr.y, x1, y1, def.size * 0.5, (p) =>
        (p.id === pr.owner && pr.age < 0.25 && !def.boomerang) || (p.id === pr.owner && !!def.boomerang) || pr.hit.includes(p.id),
      );

      if (ent && ent.t <= wallT) {
        const hx = pr.x + (x1 - pr.x) * ent.t;
        const hy = pr.y + (y1 - pr.y) * ent.t;
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        const k = wd.knock ?? 0;
        const kx = (pr.vx / sp) * k;
        const ky = (pr.vy / sp) * k;
        if (def.explode && (def.bounce === 0 || def.explodeOnPlayer) && !def.vortex) {
          this.explode(hx, hy, def.explode, pr.owner, pr.wid, pr.mult);
          if (def.split?.onImpact) this.split(pr, hx, hy, add);
          remove.add(pr);
          continue;
        }
        if (def.split?.onImpact) {
          this.split(pr, hx, hy, add);
          remove.add(pr);
          continue;
        }
        if (ent.p) {
          this.damage(ent.p, wd.damage * pr.mult, pr.owner, pr.wid, kx, ky);
          if (def.freeze) ent.p.slow = Math.max(ent.p.slow, def.freeze);
          if (def.bubble && ent.p.alive) ent.p.bubble = def.bubble;
          pr.hit.push(ent.p.id);
        } else if (ent.o) {
          this.damageProp(ent.o, Math.max(wd.damage, 10) * pr.mult, pr.owner, kx, ky);
          this.emit({ k: 'wall', x: hx | 0, y: hy | 0, c: PROP_INFO[ent.o.kind].edge });
        }
        if (def.vortex) {
          pr.x = hx;
          pr.y = hy;
          pr.life = pr.age;
          continue;
        }
        if (!def.pierce || ent.o) {
          remove.add(pr);
          continue;
        }
      }

      if (wall) {
        const hx = wall.x;
        const hy = wall.y;
        this.damageTile(wall.cx, wall.cy, (wd.tileDamage ?? 0) * pr.mult);
        if (def.stick) {
          pr.x = hx + wall.nx * 2;
          pr.y = hy + wall.ny * 2;
          pr.vx = 0;
          pr.vy = 0;
          pr.stuck = true;
          if (!def.mine) pr.life = pr.age + 0.8;
          this.emit({ k: 'wall', x: hx | 0, y: hy | 0, c: '#ddd' });
          continue;
        }
        if (def.bounce > 0 && (def.maxBounces === undefined || pr.bounces < def.maxBounces)) {
          pr.bounces++;
          if (wall.nx !== 0) pr.vx = -pr.vx * def.bounce;
          if (wall.ny !== 0) pr.vy = -pr.vy * def.bounce;
          if (def.gravity > 0) pr.vx *= 0.85;
          pr.x = hx + wall.nx * 1.5;
          pr.y = hy + wall.ny * 1.5;
          continue;
        }
        if (def.split?.onImpact) {
          this.split(pr, hx + wall.nx * 4, hy + wall.ny * 4, add);
          if (def.explode) this.explode(hx, hy, def.explode, pr.owner, pr.wid, pr.mult);
          remove.add(pr);
          continue;
        }
        if (def.explode && !def.vortex) {
          this.explode(hx + wall.nx * 3, hy + wall.ny * 3, def.explode, pr.owner, pr.wid, pr.mult);
          remove.add(pr);
          continue;
        }
        if (def.vortex) {
          pr.x = hx + wall.nx * 6;
          pr.y = hy + wall.ny * 6;
          pr.life = pr.age;
          continue;
        }
        this.emit({ k: 'wall', x: hx | 0, y: hy | 0, c: wd.color });
        remove.add(pr);
        continue;
      }

      pr.x = x1;
      pr.y = y1;
      if (pr.y > this.map.pxH + 400) remove.add(pr);
    }
    if (remove.size) this.projectiles = this.projectiles.filter((p) => !remove.has(p));
    for (const f of add) f();

    // Лимит мин на игрока
    const mines = new Map<number, Projectile[]>();
    for (const pr of this.projectiles) {
      if (WEAPONS[pr.wid].proj?.mine) {
        const arr = mines.get(pr.owner) ?? [];
        arr.push(pr);
        mines.set(pr.owner, arr);
      }
    }
    for (const arr of mines.values()) {
      while (arr.length > 6) {
        const old = arr.shift()!;
        old.life = old.age;
      }
    }
  }

  private projectileExpire(pr: Projectile, add: (() => void)[]) {
    const def = WEAPONS[pr.wid].proj!;
    if (def.vortex) {
      pr.active = def.vortex.duration;
      pr.vx = 0;
      pr.vy = 0;
      this.emit({ k: 'vortex', x: pr.x | 0, y: pr.y | 0, r: def.vortex.radius, d: def.vortex.duration });
      return;
    }
    if (def.split) this.split(pr, pr.x, pr.y, add);
    if (def.explode) this.explode(pr.x, pr.y, def.explode, pr.owner, pr.wid, pr.mult);
  }

  private split(pr: Projectile, x: number, y: number, add: (() => void)[]) {
    const def = WEAPONS[pr.wid].proj!;
    const s = def.split!;
    const base = Math.atan2(pr.vy, pr.vx);
    const owner = this.players.get(pr.owner) ?? null;
    const radial = s.spread >= 6;
    add.push(() => {
      for (let i = 0; i < s.count; i++) {
        // Осколки зенитки — по кругу; бомбочки кассеты — веером вверх-вперёд.
        const ang = radial
          ? (i / s.count) * Math.PI * 2 + rand(-0.2, 0.2)
          : -Math.PI / 2 + Math.sign(Math.cos(base)) * 0.3 + rand(-s.spread, s.spread) * 0.6;
        const speed = radial ? rand(700, 1000) : rand(300, 600);
        const child = this.spawnProjectile(s.weapon, owner, x, y, ang, speed, pr.mult);
        child.owner = pr.owner;
        child.team = pr.team;
        child.age = 0.3; // чтобы могли задеть и владельца
        child.life += 0.3;
      }
    });
  }

  private applyVortex(pr: Projectile, dt: number) {
    const v = WEAPONS[pr.wid].proj!.vortex!;
    const pull = (b: { x: number; y: number; vx: number; vy: number }, m: number) => {
      const dx = pr.x - b.x;
      const dy = pr.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > v.radius || d < 4) return 0;
      const f = (1 - d / v.radius) * v.force * dt / m;
      b.vx += (dx / d) * f;
      b.vy += (dy / d) * f - 900 * dt * (1 - d / v.radius);
      return 1 - d / v.radius;
    };
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const f = pull(p, 1);
      if (f > 0.6) this.damage(p, v.dps * dt * pr.mult, pr.owner, pr.wid, 0, 0);
    }
    for (const o of this.props) pull(o, o.mass);
    for (const o of this.projectiles) if (o !== pr && !o.stuck) pull(o, 0.5);
  }

  nearestEnemy(x: number, y: number, owner: number, team: number, range: number, dir?: number, cone?: number): Player | null {
    let best: Player | null = null;
    let bestD = range * range;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === owner) continue;
      if (this.settings.mode === 'tdm' && team >= 0 && p.team === team) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d > bestD) continue;
      if (dir !== undefined && cone !== undefined) {
        let da = Math.atan2(p.y - y, p.x - x) - dir;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > cone) continue;
      }
      if (!this.map.lineOfSight(x, y, p.x, p.y)) continue;
      bestD = d;
      best = p;
    }
    return best;
  }

  // ------------------------------------------------------------------ ящики

  private spawnProp(home: number) {
    const { kind, x, y } = this.parsed.props[home];
    const info = PROP_INFO[kind];
    const o: Prop = {
      id: this.nextPropId++,
      home,
      kind,
      x,
      y: y + TILE / 2 - info.h / 2 - 0.5,
      w: info.w,
      h: info.h,
      vx: 0,
      vy: 0,
      hp: info.hp,
      maxHp: info.hp,
      mass: info.mass,
      onGround: false,
      lastHitBy: -1,
      rx: x,
      ry: y,
      ox: x,
      oy: y,
    };
    this.props.push(o);
  }

  private stepProps(dt: number) {
    for (const o of this.props) {
      o.vy += PHYS.gravity * dt;
      if (o.vy > PHYS.maxFall) o.vy = PHYS.maxFall;
      const res = moveBox(this.map, o, dt, true);
      if (res.hitY && Math.abs(res.impactVY) > 500) {
        o.vy = -res.impactVY * 0.25;
        if (Math.abs(res.impactVY) > 1100) o.hp -= 10;
      }
      if (res.hitX && Math.abs(res.impactVX) > 300) o.vx = -res.impactVX * 0.3;
      o.onGround = res.onGround;
      if (o.onGround) {
        const f = 1400 * dt;
        o.vx = Math.abs(o.vx) <= f ? 0 : o.vx - Math.sign(o.vx) * f;
      } else {
        o.vx *= 1 - 0.3 * dt;
      }
      if (o.y > this.map.pxH + 300) o.hp = 0;
    }
    for (const o of [...this.props]) if (o.hp <= 0) this.destroyProp(o);

    // Ящики сталкиваются друг с другом и могут стоять друг на друге.
    for (let i = 0; i < this.props.length; i++) {
      for (let j = i + 1; j < this.props.length; j++) {
        const a = this.props[i];
        const b = this.props[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 - Math.abs(dx);
        const oy = (a.h + b.h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const ma = a.mass;
        const mb = b.mass;
        if (oy < ox) {
          const s = Math.sign(dy) || 1;
          const top = s > 0 ? a : b;
          const bottom = s > 0 ? b : a;
          top.y -= oy;
          if (top.vy > bottom.vy) top.vy = bottom.vy;
          top.onGround = true;
          top.vx += (bottom.vx - top.vx) * 0.2;
        } else {
          const s = Math.sign(dx) || 1;
          a.x -= s * ox * (mb / (ma + mb));
          b.x += s * ox * (ma / (ma + mb));
          const avg = (a.vx * ma + b.vx * mb) / (ma + mb);
          a.vx = avg;
          b.vx = avg;
        }
      }
    }

    for (const r of this.propRespawns) r.timer -= dt;
    const ready = this.propRespawns.filter((r) => r.timer <= 0);
    if (ready.length) {
      this.propRespawns = this.propRespawns.filter((r) => r.timer > 0);
      for (const r of ready) this.spawnProp(r.home);
    }
  }

  // ------------------------------------------------------------------ предметы

  private stepItems(dt: number) {
    for (const it of this.items) {
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) {
          it.active = true;
          if (it.kind === 'weapon') it.sub = pick(SPAWN_POOL);
          if (it.kind === 'power') {
            it.sub = Math.floor(Math.random() * POWERS.length);
            this.emit({ k: 'msg', text: `Появился усилитель: ${POWERS[it.sub].name}` });
          }
        }
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.abs(p.x - it.x) > 24 || Math.abs(p.y - it.y) > 34) continue;
        if (this.pickup(p, it)) {
          it.active = false;
          it.timer = ITEM_RESPAWN[it.kind];
          this.emit({ k: 'pick', p: p.id, kind: it.kind, sub: it.sub, x: it.x | 0, y: it.y | 0 });
          break;
        }
      }
    }
  }

  private pickup(p: Player, it: Item): boolean {
    switch (it.kind) {
      case 'health':
        if (p.hp >= PHYS.maxHealth) return false;
        p.hp = Math.min(PHYS.maxHealth, p.hp + 25);
        return true;
      case 'mega':
        p.hp = Math.min(PHYS.overHealth, p.hp + 100);
        return true;
      case 'armor':
        if (p.armor >= PHYS.maxArmor) return false;
        p.armor = Math.min(PHYS.maxArmor, p.armor + 50);
        return true;
      case 'armorBig':
        if (p.armor >= PHYS.maxArmor) return false;
        p.armor = Math.min(PHYS.maxArmor, p.armor + 100);
        return true;
      case 'ammo': {
        let any = false;
        for (const w of WEAPONS) {
          if (!p.has(w.id) || p.ammo[w.id] < 0 || p.ammo[w.id] >= w.maxAmmo) continue;
          p.ammo[w.id] = Math.min(w.maxAmmo, p.ammo[w.id] + Math.ceil(w.ammo / 2));
          any = true;
        }
        return any;
      }
      case 'weapon': {
        const w = WEAPONS[it.sub];
        if (!p.has(w.id)) {
          p.owned |= 1 << w.id;
          p.ammo[w.id] = w.ammo;
          if (p.weapon <= 1 || p.isBot) p.weapon = w.id;
          return true;
        }
        if (p.ammo[w.id] >= w.maxAmmo) return false;
        p.ammo[w.id] = Math.min(w.maxAmmo, p.ammo[w.id] + w.ammo);
        return true;
      }
      case 'power': {
        const pw = POWERS[it.sub];
        p.powers[pw.kind] = pw.duration;
        this.emit({ k: 'msg', text: `${p.name}: ${pw.name}!` });
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ конец матча

  private checkEnd() {
    const s = this.settings;
    let winner = '';
    if (s.mode === 'tdm') {
      const score = [0, 0];
      for (const p of this.players.values()) if (p.team >= 0) score[p.team] += p.frags;
      const limit = s.fragLimit * 2;
      if (score[0] >= limit || score[1] >= limit || this.timeLeft <= 0) {
        winner = score[0] === score[1] ? 'Ничья' : score[0] > score[1] ? 'Красные' : 'Синие';
      }
    } else {
      let top: Player | null = null;
      for (const p of this.players.values()) if (!top || p.frags > top.frags) top = p;
      if (top && (top.frags >= s.fragLimit || this.timeLeft <= 0)) winner = top.name;
      else if (!top && this.timeLeft <= 0) winner = '—';
    }
    if (winner) {
      this.phase = 'end';
      this.endTimer = 9;
      this.winner = winner;
      this.emit({ k: 'end', winner });
    }
  }
}
