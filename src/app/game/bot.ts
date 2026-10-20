import { PHYS, TILE } from './constants';
import { clamp, rand } from './math';
import { EdgeKind, NavGraph } from './nav';
import { TileMap } from './tiles';
import { Input, Item, Player } from './types';
import { WEAPONS } from './weapons';
import type { World } from './world';

/** Граф навигации общий для всех ботов; перестраивается не чаще раза в 2 с после разрушений. */
let navCache: { map: TileMap; graph: NavGraph; builtAt: number } | null = null;

function getNav(map: TileMap, time: number): NavGraph {
  if (!navCache || navCache.map !== map || (navCache.graph.version !== map.version && time - navCache.builtAt > 2)) {
    navCache = { map, graph: new NavGraph(map), builtAt: time };
  }
  return navCache.graph;
}

export class Bot {
  private seq = 0;
  private path: { node: number; kind: EdgeKind }[] = [];
  private goalNode = -1;
  private repathTimer = 0;
  private goalTimer = 0;
  private targetId = -1;
  private targetTimer = 0;
  private lastSeen = { x: 0, y: 0, t: -10 };
  private aimNoise = 0;
  private aimNoiseTarget = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private stuckTimer = 0;
  private lastPos = { x: 0, y: 0 };
  private weaponTimer = 0;
  private holdJump = 0;
  private wantW = 0;
  private reaction = 0;
  private aim = 0;

  /** skill 1..5 */
  constructor(private skill: number) {}

  think(world: World, p: Player, dt: number): Input {
    const inp: Input = { seq: ++this.seq, mx: 0, jump: false, down: false, fire: false, aim: this.aim, w: this.wantW };
    if (!p.alive) {
      this.path = [];
      this.goalNode = -1;
      return inp;
    }
    const nav = getNav(world.map, world.time);
    const s = clamp(this.skill, 1, 5);

    // --- выбор цели ---
    this.targetTimer -= dt;
    let target = this.targetId >= 0 ? world.players.get(this.targetId) : undefined;
    if (this.targetTimer <= 0 || !target || !target.alive) {
      this.targetTimer = 0.35;
      const prev = this.targetId;
      target = this.pickTarget(world, p) ?? undefined;
      this.targetId = target ? target.id : -1;
      if (target && target.id !== prev) this.reaction = 0.5 - s * 0.08;
    }
    const visible = !!target && world.map.lineOfSight(p.x, p.y - 6, target.x, target.y);
    if (target && visible) this.lastSeen = { x: target.x, y: target.y, t: world.time };
    this.reaction = Math.max(0, this.reaction - dt);

    // --- выбор оружия ---
    this.weaponTimer -= dt;
    if (this.weaponTimer <= 0) {
      this.weaponTimer = 0.8;
      const d = target ? Math.hypot(target.x - p.x, target.y - p.y) : 600;
      this.wantW = this.bestWeapon(p, d);
    }
    inp.w = this.wantW;

    // --- цель движения ---
    this.goalTimer -= dt;
    this.repathTimer -= dt;
    if (this.goalTimer <= 0 || this.goalNode < 0) {
      this.goalTimer = rand(1.2, 2.5);
      this.goalNode = this.chooseGoal(world, p, nav, target, visible);
      this.repathTimer = 0;
    }
    const myNode = nav.nearestNode(p.x, p.y);
    if (this.repathTimer <= 0 && p.onGround) {
      this.repathTimer = 0.5;
      this.path = nav.path(myNode, this.goalNode) ?? [];
      if (!this.path.length && myNode === this.goalNode) this.goalTimer = 0;
    }
    // Пропускаем пройденные узлы
    while (this.path.length && this.path[0].node === myNode) this.path.shift();

    // --- следование пути ---
    const w = world.map.w;
    if (this.path.length) {
      const next = this.path[0];
      const nx = (next.node % w) * TILE + TILE / 2;
      const ny = Math.floor(next.node / w) * TILE + TILE / 2;
      const dx = nx - p.x;
      const dy = ny - p.y;
      if (Math.abs(dx) > 5) inp.mx = Math.sign(dx);
      if (next.kind === 'jump' || next.kind === 'pad') {
        const nearX = Math.abs(dx) < (Math.abs(dy) > TILE * 3 ? TILE * 0.8 : TILE * 2.2);
        if (p.onGround && (nearX || dy > -TILE)) {
          if (next.kind === 'jump') {
            inp.jump = true;
            this.holdJump = 0.35;
          } else if (Math.abs(dx) > 4) inp.mx = Math.sign(dx);
        }
        // Двойной прыжок на вершине, если ещё не долетели
        if (!p.onGround && p.vy > -150 && dy < -TILE * 0.5 && p.airJumps === 0) {
          inp.jump = !p.jumpHeld;
          this.holdJump = 0.25;
        }
      } else if (next.kind === 'drop') {
        inp.down = true;
        inp.mx = 0;
      } else if (next.kind === 'walk' && dy < -TILE * 0.5 && p.onGround) {
        inp.jump = true;
      }
    } else if (this.goalNode >= 0) {
      const gx = (this.goalNode % w) * TILE + TILE / 2;
      if (Math.abs(gx - p.x) > 8) inp.mx = Math.sign(gx - p.x);
    }
    if (this.holdJump > 0) {
      this.holdJump -= dt;
      if (!inp.jump && p.jumpHeld) inp.jump = true;
    }

    // --- бой: уклонение ---
    if (target && visible) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(0.3, 0.9);
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < 0.15 * s && p.onGround) inp.jump = true;
      }
      if (!this.path.length || Math.random() < 0.3) {
        const d = Math.abs(target.x - p.x);
        const [lo, hi] = WEAPONS[p.weapon].botRange;
        if (d < lo) inp.mx = -Math.sign(target.x - p.x);
        else if (d > hi) inp.mx = Math.sign(target.x - p.x);
        else inp.mx = this.strafeDir;
      }
    }

    // --- не падать в пропасть ---
    if (inp.mx !== 0 && p.onGround && world.parsed.def.openBottom) {
      const aheadX = p.x + inp.mx * TILE;
      if (!this.groundBelow(world.map, aheadX, p.y, 14)) {
        const pathFalls = this.path.length && (this.path[0].kind === 'fall' || this.path[0].kind === 'jump');
        if (!pathFalls) inp.mx = 0;
      }
    }
    if (!p.onGround && p.vy > 200 && world.parsed.def.openBottom && !this.groundBelow(world.map, p.x, p.y, 20)) {
      // Падаем мимо — тянемся к ближайшей опоре и жмём двойной прыжок.
      const left = this.groundBelow(world.map, p.x - TILE * 3, p.y, 20);
      const right = this.groundBelow(world.map, p.x + TILE * 3, p.y, 20);
      inp.mx = right && !left ? 1 : left && !right ? -1 : inp.mx || 1;
      if (p.airJumps === 0) inp.jump = !p.jumpHeld;
    }

    // --- застревание ---
    if (inp.mx !== 0 && Math.hypot(p.x - this.lastPos.x, p.y - this.lastPos.y) < 1.5) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.5) {
        inp.jump = true;
        this.holdJump = 0.3;
        if (this.stuckTimer > 1.4) {
          this.goalNode = nav.randomNode();
          this.repathTimer = 0;
          this.stuckTimer = 0;
          // Застряли перед стеной — пробуем её разломать.
          inp.fire = true;
        }
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    }
    this.lastPos = { x: p.x, y: p.y };

    // --- прицеливание и стрельба ---
    this.aimNoiseTarget += (Math.random() - 0.5) * dt * 4;
    this.aimNoiseTarget = clamp(this.aimNoiseTarget, -1, 1);
    this.aimNoise += (this.aimNoiseTarget - this.aimNoise) * dt * 3;
    const err = (0.3 - s * 0.05) * this.aimNoise;
    if (target && visible) {
      const wd = WEAPONS[p.weapon];
      let tx = target.x;
      let ty = target.y - 4;
      const d = Math.hypot(tx - p.x, ty - p.y);
      if (wd.proj && wd.proj.speed > 0) {
        const t = d / wd.proj.speed;
        const lead = 0.4 + s * 0.12;
        tx += target.vx * t * lead;
        ty += target.vy * t * lead * 0.5;
        if (wd.proj.gravity > 0) ty -= 0.5 * PHYS.gravity * wd.proj.gravity * t * t;
        if (wd.proj.explode && target.onGround) ty += target.h / 2 - 2; // ракеты — под ноги
      }
      const want = Math.atan2(ty - (p.y - 6), tx - p.x) + err;
      const turn = (4 + s * 3) * dt;
      let da = want - this.aim;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.aim += clamp(da, -turn, turn);
      const range = wd.range ?? (wd.proj ? wd.proj.speed * wd.proj.life : 600);
      if (this.reaction <= 0 && Math.abs(da) < 0.25 && d < range * 1.05) {
        const selfRisk = wd.proj?.explode && d < wd.proj.explode.radius * 0.9;
        if (!selfRisk) inp.fire = true;
      }
    } else {
      // Смотрим по ходу движения или туда, где видели врага.
      const recent = world.time - this.lastSeen.t < 2;
      const want = recent
        ? Math.atan2(this.lastSeen.y - p.y, this.lastSeen.x - p.x)
        : inp.mx !== 0
          ? (inp.mx > 0 ? 0 : Math.PI) + Math.sin(world.time * 2) * 0.2
          : this.aim;
      let da = want - this.aim;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.aim += clamp(da, -5 * dt, 5 * dt);
      if (WEAPONS[p.weapon].spinup && recent) inp.fire = true;
    }
    inp.aim = this.aim;
    return inp;
  }

  private pickTarget(world: World, p: Player): Player | null {
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const o of world.players.values()) {
      if (o === p || !o.alive) continue;
      if (world.settings.mode === 'tdm' && o.team === p.team) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > 1500) continue;
      const vis = world.map.lineOfSight(p.x, p.y - 6, o.x, o.y);
      const score = d * (vis ? 1 : 3) + o.hp * 1.5 - (o.id === this.targetId ? 200 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private bestWeapon(p: Player, d: number): number {
    let best = p.weapon;
    let bestScore = -1;
    for (const w of WEAPONS) {
      if (!p.has(w.id) || p.ammo[w.id] === 0) continue;
      const [lo, hi] = w.botRange;
      let sc = w.botScore * (d >= lo && d <= hi ? 1 : 0.35);
      if (w.proj?.explode && d < w.proj.explode.radius) sc *= 0.2;
      if (w.id === p.weapon) sc *= 1.15; // не дёргаться
      if (sc > bestScore) {
        bestScore = sc;
        best = w.id;
      }
    }
    return best;
  }

  private chooseGoal(world: World, p: Player, nav: NavGraph, target: Player | undefined, visible: boolean): number {
    const wanted: { it: Item; score: number }[] = [];
    let ownedCount = 0;
    for (const w of WEAPONS) if (p.has(w.id)) ownedCount++;
    for (const it of world.items) {
      if (!it.active) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      let v = 0;
      switch (it.kind) {
        case 'health': v = p.hp < 70 ? 80 - p.hp * 0.5 : 0; break;
        case 'mega': v = 60; break;
        case 'armor': v = p.armor < 100 ? 30 : 0; break;
        case 'armorBig': v = p.armor < 100 ? 45 : 0; break;
        case 'ammo': v = 12; break;
        case 'weapon': v = p.has(it.sub) ? 6 : ownedCount <= 2 ? 90 : 35; break;
        case 'power': v = 70; break;
      }
      if (v > 0) wanted.push({ it, score: v / (1 + d / 400) });
    }
    wanted.sort((a, b) => b.score - a.score);
    const hunting = target && (visible || Math.random() < 0.6) && p.hp > 40 && ownedCount > 2;
    if (hunting && (!wanted.length || wanted[0].score < 25)) {
      return nav.nearestNode(target.x, target.y);
    }
    if (wanted.length && Math.random() < 0.85) {
      const choice = wanted[Math.min(wanted.length - 1, Math.floor(Math.random() * Math.min(2, wanted.length)))];
      return nav.nearestNode(choice.it.x, choice.it.y);
    }
    if (target) return nav.nearestNode(target.x, target.y);
    return nav.randomNode();
  }

  private groundBelow(map: TileMap, x: number, y: number, rows: number) {
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    for (let r = 0; r <= rows; r++) if (map.isStandable(cx, cy + r)) return true;
    return false;
  }
}
