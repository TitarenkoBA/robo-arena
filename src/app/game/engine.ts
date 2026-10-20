import { BOT_NAMES, DT, SNAPSHOT_RATE, TICK_RATE } from './constants';
import { Effects } from './effects';
import { InputManager } from './input';
import { ClientMsg, ClientState, HostMsg, decodeInput, encodeInput, encodeMe, encodeSnapshot } from './net';
import { Renderer, View } from './renderer';
import { GameEvent, GameSettings, Input, Player, RosterEntry } from './types';
import { WEAPONS } from './weapons';
import { World } from './world';
import { pick } from './math';
import type { PeerJsService } from '../services/peerjs.service';
import type { SfxService } from '../services/sfx.service';

export type Role = 'host' | 'client' | 'offline';

export interface UiState {
  phase: 'play' | 'end' | 'loading';
  roster: RosterEntry[];
  winner: string;
  myId: number;
  connected: boolean;
  bots: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  role: Role;
  settings: GameSettings;
  name: string;
  color: string;
  peer: PeerJsService;
  sfx: SfxService;
  onUi: (s: UiState) => void;
  onMenu: () => void;
}

const SNAP_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);

export class GameEngine {
  readonly role: Role;
  private world: World | null = null;
  private client: ClientState | null = null;
  private localId = -1;
  readonly input: InputManager;
  readonly fx: Effects;
  readonly renderer: Renderer;
  private raf = 0;
  private bgTimer = 0;
  private last = 0;
  private acc = 0;
  private tick = 0;
  private seq = 0;
  private wantWeapon = 0;
  private sentInputs: number[][] = [];
  private pendingEvents: GameEvent[] = [];
  private peers = new Map<string, { playerId: number; lastSeq: number }>();
  private lastGen = 0;
  private rosterTimer = 0;
  private uiTimer = 0;
  private pingTimer = 0;
  private rtt = 0;
  private connected = true;
  paused = false;
  private destroyed = false;

  constructor(private o: EngineOptions) {
    this.role = o.role;
    this.input = new InputManager(o.canvas);
    this.input.onMenu = o.onMenu;
    this.fx = new Effects((name, x, y, vol) => o.sfx.play(name, x, y, vol));
    this.renderer = new Renderer(o.canvas, this.fx, this.input);

    if (o.role === 'client') {
      o.peer.setHandlers({
        onMessage: (_, m) => this.onHostMessage(m as HostMsg),
        onHostLost: () => {
          this.connected = false;
          this.pushUi(true);
        },
      });
      this.sendToHost({ t: 'hello', name: o.name, color: o.color }, true);
    } else {
      const w = new World(o.settings);
      this.world = w;
      this.lastGen = w.generation;
      this.localId = w.addPlayer(o.name, o.color, false).id;
      for (let i = 0; i < o.settings.bots; i++) this.addBot();
      if (o.role === 'host') {
        o.peer.setHandlers({
          onJoin: () => {},
          onLeave: (peerId) => {
            const info = this.peers.get(peerId);
            if (info) w.removePlayer(info.playerId);
            this.peers.delete(peerId);
          },
          onMessage: (peerId, m) => this.onClientMessage(peerId, m as ClientMsg),
        });
      }
    }

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    this.pushUi(true);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.bgTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.input.destroy();
    this.o.peer.setHandlers({});
  }

  private onResize = () => this.renderer.resize();

  /** Хост в фоновой вкладке продолжает симуляцию, чтобы игра не замирала у остальных. */
  private onVisibility = () => {
    window.clearInterval(this.bgTimer);
    if (document.hidden && this.role === 'host') {
      this.bgTimer = window.setInterval(() => this.advance(performance.now(), false), 50);
    } else {
      this.last = performance.now();
    }
  };

  // ------------------------------------------------------------- управление ботами (хост)

  addBot() {
    const w = this.world;
    if (!w) return;
    const used = new Set([...w.players.values()].map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? pick(free) : `Бот-${w.players.size}`;
    w.addPlayer(name, pick(['#4fc3f7', '#ff8a65', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#7986cb']), true);
    this.pushUi(true);
  }

  removeBot() {
    const w = this.world;
    if (!w) return;
    const bots = [...w.players.values()].filter((p) => p.isBot);
    const last = bots[bots.length - 1];
    if (last) w.removePlayer(last.id);
    this.pushUi(true);
  }

  restartMatch() {
    this.world?.restart();
  }

  // ------------------------------------------------------------- сеть

  private sendToHost(m: ClientMsg, reliable: boolean) {
    this.o.peer.sendToHost(m, reliable);
  }

  private sendWelcome(peerId: string, playerId: number) {
    const w = this.world!;
    const crack: number[] = [];
    for (let i = 0; i < w.map.crack.length; i++) if (w.map.crack[i]) crack.push(i, w.map.crack[i]);
    const msg: HostMsg = { t: 'welcome', you: playerId, settings: w.settings, tiles: w.map.encode(), crack, gen: w.generation };
    this.o.peer.send(peerId, msg, true);
    this.o.peer.send(peerId, { t: 'roster', l: w.roster() } satisfies HostMsg, true);
  }

  private onClientMessage(peerId: string, m: ClientMsg) {
    const w = this.world;
    if (!w || !m || typeof m !== 'object') return;
    const info = this.peers.get(peerId);
    switch (m.t) {
      case 'hello': {
        if (info) return;
        if (w.players.size >= 16) {
          this.o.peer.send(peerId, { t: 'full' } satisfies HostMsg, true);
          return;
        }
        const name = String(m.name ?? 'Игрок').slice(0, 16) || 'Игрок';
        const p = w.addPlayer(name, String(m.color ?? '#fff'), false);
        this.peers.set(peerId, { playerId: p.id, lastSeq: 0 });
        this.sendWelcome(peerId, p.id);
        break;
      }
      case 'in': {
        if (!info || !Array.isArray(m.l)) return;
        const p = w.players.get(info.playerId);
        if (!p) return;
        for (const raw of m.l) {
          if (!Array.isArray(raw) || raw[0] <= info.lastSeq) continue;
          info.lastSeq = raw[0];
          const inp = decodeInput(raw);
          if (!Number.isFinite(inp.aim)) continue;
          inp.mx = Math.max(-1, Math.min(1, inp.mx));
          p.inputQueue.push(inp);
        }
        break;
      }
      case 'ping': {
        if (info) {
          const p = w.players.get(info.playerId);
          if (p && typeof m.r === 'number') p.ping = m.r;
        }
        this.o.peer.send(peerId, { t: 'pong', c: m.c } satisfies HostMsg, false);
        break;
      }
      case 'chat':
        break;
    }
  }

  private onHostMessage(m: HostMsg) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'welcome': {
        const old = this.client;
        this.client = new ClientState(m);
        if (old) this.client.roster = old.roster;
        this.localId = m.you;
        this.fx.winner = '';
        this.pushUi(true);
        break;
      }
      case 'roster':
        this.client?.setRoster(m.l);
        this.pushUi(true);
        break;
      case 's':
        if (this.client) {
          this.client.applySnapshot(m, performance.now());
          if (this.client.roster.length) this.client.setRoster(this.client.roster);
        }
        break;
      case 'ev':
        if (!this.client) return;
        this.client.applyEvents(m.e);
        for (const e of m.e) {
          if (e.k === 'jump' && e.p === this.localId) continue; // уже проиграно локально
          this.handleEvent(e, this.client.players, this.client.map);
        }
        break;
      case 'pong':
        this.rtt = performance.now() - m.c;
        break;
      case 'full':
        this.fx.messages.push({ text: 'Комната заполнена', t: 5 });
        break;
      case 'chat':
        break;
    }
  }

  private handleEvent(e: GameEvent, players: Map<number, Player>, map: World['map']) {
    this.fx.handle(e, players, this.localId, map);
    if (e.k === 'tile' || e.k === 'crack') this.renderer.redrawTile(map, e.i);
    if (e.k === 'end' || e.k === 'kill') this.pushUi(true);
  }

  // ------------------------------------------------------------- цикл

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.advance(now, true);
    this.raf = requestAnimationFrame(this.frame);
  };

  private advance(now: number, render: boolean) {
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25;
    if (frameDt < 0) frameDt = 0;
    this.acc += frameDt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.fixedStep();
    }
    if (render) this.draw(now, frameDt);
  }

  private buildInput(me: Player | null): Input {
    const r = this.input.read(this.renderer.aimFromMouse(me));
    if (me) {
      const owned = WEAPONS.filter((w) => me.has(w.id)).map((w) => w.id);
      const delta = this.input.takeWeaponDelta();
      const slot = this.input.takeSlot();
      if (delta !== 0 && owned.length) {
        let idx = owned.indexOf(me.weapon);
        if (idx < 0) idx = 0;
        this.wantWeapon = owned[(idx + delta + owned.length * 10) % owned.length];
      }
      if (slot !== null && owned[slot] !== undefined) this.wantWeapon = owned[slot];
    }
    return { seq: ++this.seq, mx: r.mx, jump: r.jump, down: r.down, fire: r.fire, aim: r.aim, w: this.wantWeapon };
  }

  private fixedStep() {
    this.tick++;
    if (this.world) this.hostStep();
    else if (this.client) this.clientStep();
  }

  private hostStep() {
    const w = this.world!;
    const me = w.players.get(this.localId) ?? null;
    for (const p of w.players.values()) {
      p.ox = p.x;
      p.oy = p.y;
    }
    for (const r of w.projectiles) {
      r.ox = r.x;
      r.oy = r.y;
    }
    for (const o of w.props) {
      o.ox = o.x;
      o.oy = o.y;
    }
    const inp = this.buildInput(me);
    if (this.paused) return;
    me?.inputQueue.push(inp);
    w.step(DT);

    if (w.generation !== this.lastGen) {
      this.lastGen = w.generation;
      this.fx.winner = '';
      for (const [peerId, info] of this.peers) this.sendWelcome(peerId, info.playerId);
      this.pushUi(true);
    }

    const events = w.events;
    w.events = [];
    for (const e of events) this.handleEvent(e, w.players, w.map);
    if (this.role !== 'host') return;
    this.pendingEvents.push(...events);

    if (this.tick % SNAP_EVERY === 0 && this.peers.size) {
      const common = encodeSnapshot(w, this.tick);
      for (const [peerId, info] of this.peers) {
        const p = w.players.get(info.playerId);
        this.o.peer.send(peerId, { ...common, me: p ? encodeMe(p) : undefined } satisfies HostMsg, false);
        if (this.pendingEvents.length) this.o.peer.send(peerId, { t: 'ev', e: this.pendingEvents } satisfies HostMsg, true);
      }
      this.pendingEvents = [];
    } else if (!this.peers.size) {
      this.pendingEvents = [];
    }

    this.rosterTimer -= DT;
    if (w.rosterDirty || this.rosterTimer <= 0) {
      w.rosterDirty = false;
      this.rosterTimer = 1;
      const msg: HostMsg = { t: 'roster', l: w.roster() };
      for (const peerId of this.peers.keys()) this.o.peer.send(peerId, msg, true);
    }
  }

  private clientStep() {
    const c = this.client!;
    const inp = this.buildInput(c.me);
    c.predict(inp, (kind, p) => this.fx.localJump(kind, p.x, p.y + p.h / 2));
    this.sentInputs.push(encodeInput(inp));
    if (this.sentInputs.length > 4) this.sentInputs.shift();
    // Каждый пакет несёт последние 4 команды — переживает потерю пакетов.
    this.sendToHost({ t: 'in', l: this.sentInputs }, false);

    this.pingTimer -= DT;
    if (this.pingTimer <= 0) {
      this.pingTimer = 1;
      this.sendToHost({ t: 'ping', c: performance.now(), r: Math.round(this.rtt) }, false);
    }
  }

  private draw(now: number, frameDt: number) {
    let view: View | null = null;
    if (this.world) {
      const w = this.world;
      const alpha = this.acc / DT;
      const lerpE = (e: { x: number; y: number; ox: number; oy: number; rx: number; ry: number }) => {
        if (Math.abs(e.x - e.ox) > 100 || Math.abs(e.y - e.oy) > 100) {
          e.rx = e.x;
          e.ry = e.y;
        } else {
          e.rx = e.ox + (e.x - e.ox) * alpha;
          e.ry = e.oy + (e.y - e.oy) * alpha;
        }
      };
      for (const p of w.players.values()) lerpE(p);
      for (const r of w.projectiles) lerpE(r);
      for (const o of w.props) lerpE(o);
      view = {
        map: w.map, def: w.parsed.def, players: w.players, projectiles: w.projectiles, props: w.props, items: w.items,
        me: w.players.get(this.localId) ?? null, timeLeft: w.timeLeft, phase: w.phase, settings: w.settings, ping: 0,
      };
    } else if (this.client) {
      const c = this.client;
      c.updateRender(now, frameDt);
      view = {
        map: c.map, def: c.parsed.def, players: c.players, projectiles: c.projectiles.values(), props: c.props.values(),
        items: c.items, me: c.me, timeLeft: c.timeLeft, phase: c.phase, settings: c.settings, ping: this.rtt,
      };
    }
    if (!view) {
      this.drawLoading();
      return;
    }
    this.fx.update(frameDt, view.map, view.players.values());
    this.renderer.render(view, frameDt);
    this.o.sfx.setListener(this.renderer.cam.x, this.renderer.cam.y);

    this.uiTimer -= frameDt;
    if (this.uiTimer <= 0) this.pushUi(false);
  }

  private drawLoading() {
    const cv = this.o.canvas;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#141a2e';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(cv.height / 20)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Загрузка арены...', cv.width / 2, cv.height / 2);
  }

  private pushUi(force: boolean) {
    if (!force && this.uiTimer > 0) return;
    this.uiTimer = 0.5;
    const roster = this.world ? this.world.roster() : this.client?.roster ?? [];
    const phase = this.world ? this.world.phase : this.client ? this.client.phase : 'loading';
    this.o.onUi({
      phase,
      roster,
      winner: this.fx.winner,
      myId: this.localId,
      connected: this.connected,
      bots: roster.filter((r) => r.bot).length,
    });
  }
}
