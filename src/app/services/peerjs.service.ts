import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import Peer, { DataConnection, PeerOptions } from 'peerjs';
import { environment } from '../../environments/environment';

/** Опции PeerJS — как в проекте p2p (сигнальный сервер + STUN/TURN). */
function buildPeerOptions(): PeerOptions {
  return {
    host: environment.peerjs.host,
    port: environment.peerjs.port,
    path: environment.peerjs.path,
    secure: environment.peerjs.secure,
    debug: environment.production ? 0 : 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
          username: 'peerjs',
          credential: 'peerjsp'
        }
      ]
    }
  };
}

export type PeerRole = 'host' | 'guest' | null;

/** Префикс, чтобы коды комнат игры не пересекались с другими приложениями на том же сервере. */
export const ROOM_PREFIX = 'robo2d-';

interface Link {
  /** Надёжный упорядоченный канал: служебные сообщения и события. */
  r?: DataConnection;
  /** Ненадёжный канал: снапшоты и ввод (потеря пакета не тормозит остальные). */
  u?: DataConnection;
  joined: boolean;
}

export interface PeerHandlers {
  onJoin?: (peerId: string) => void;
  onLeave?: (peerId: string) => void;
  onMessage?: (peerId: string, msg: unknown) => void;
  onStatus?: (status: string) => void;
  onHostLost?: () => void;
}

@Injectable({ providedIn: 'root' })
export class PeerJsService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private peer?: Peer;
  private links = new Map<string, Link>();
  private hostId = '';
  private handlers: PeerHandlers = {};

  readonly myPeerId = signal<string | null>(null);
  readonly role = signal<PeerRole>(null);
  readonly status = signal('Нет соединения');
  readonly peerCount = signal(0);

  setHandlers(h: PeerHandlers) {
    this.handlers = h;
  }

  static randomRoomCode(): string {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  /** Создать комнату. Возвращает код комнаты (без префикса). */
  async createRoom(code = PeerJsService.randomRoomCode()): Promise<string> {
    this.disconnect(false);
    this.role.set('host');
    this.setStatus('Подключение к серверу...');
    const peer = new Peer(ROOM_PREFIX + code, buildPeerOptions());
    this.peer = peer;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Сервер не ответил'));
        }
      }, 15000);

      peer.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        this.zone.run(() => this.myPeerId.set(code));
        this.setStatus('Комната создана');
        resolve(code);
      });
      peer.on('connection', (conn) => this.acceptConnection(conn));
      peer.on('disconnected', () => {
        this.setStatus('Потеряна связь с сервером, переподключаемся...');
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        this.setStatus(`Ошибка: ${err.message}`);
        if (!settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          reject(err);
        }
      });
    });
  }

  /** Подключиться к комнате по коду. */
  async joinRoom(code: string): Promise<void> {
    const target = code.trim().toLowerCase().replace(ROOM_PREFIX, '');
    if (!target) throw new Error('Введите код комнаты');
    this.disconnect(false);
    this.role.set('guest');
    this.setStatus('Подключение к серверу...');
    const peer = new Peer(buildPeerOptions());
    this.peer = peer;
    this.hostId = ROOM_PREFIX + target;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.setStatus(`Ошибка: ${err.message}`);
        reject(err);
      };
      const timeoutId = window.setTimeout(() => fail(new Error('Хост не отвечает')), 20000);

      peer.on('open', () => {
        this.zone.run(() => this.myPeerId.set(peer.id ?? null));
        this.setStatus('Соединение с хостом...');
        const r = peer.connect(this.hostId, { label: 'r', reliable: true, serialization: 'json' });
        const u = peer.connect(this.hostId, { label: 'u', reliable: false, serialization: 'json' });
        const link: Link = { r, u, joined: false };
        this.links.set(this.hostId, link);
        this.bindConnection(this.hostId, r, link);
        this.bindConnection(this.hostId, u, link);
        r.on('open', () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          this.setStatus('Подключено');
          resolve();
        });
      });
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        const msg = err.type === 'peer-unavailable' ? 'Комната не найдена' : err.message;
        fail(new Error(msg));
      });
    });
  }

  private acceptConnection(conn: DataConnection) {
    const id = conn.peer;
    let link = this.links.get(id);
    if (!link) {
      link = { joined: false };
      this.links.set(id, link);
    }
    if (conn.label === 'u') link.u = conn;
    else link.r = conn;
    this.bindConnection(id, conn, link);
  }

  private bindConnection(peerId: string, conn: DataConnection, link: Link) {
    conn.on('open', () => {
      if (conn === link.r && !link.joined) {
        link.joined = true;
        this.zone.run(() => this.peerCount.set([...this.links.values()].filter((l) => l.joined).length));
        if (this.role() === 'host') this.handlers.onJoin?.(peerId);
      }
    });
    conn.on('data', (data) => this.handlers.onMessage?.(peerId, data));
    conn.on('close', () => {
      if (conn !== link.r) return;
      this.links.delete(peerId);
      link.u?.close();
      this.zone.run(() => this.peerCount.set([...this.links.values()].filter((l) => l.joined).length));
      if (this.role() === 'host') this.handlers.onLeave?.(peerId);
      else {
        this.setStatus('Хост отключился');
        this.handlers.onHostLost?.();
      }
    });
    conn.on('error', (err) => this.setStatus(`Ошибка канала: ${err.message}`));
  }

  send(peerId: string, msg: unknown, reliable = true): boolean {
    const link = this.links.get(peerId);
    if (!link) return false;
    const conn = !reliable && link.u?.open ? link.u : link.r;
    if (!conn?.open) return false;
    try {
      conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  sendToHost(msg: unknown, reliable = true) {
    return this.send(this.hostId, msg, reliable);
  }

  kick(peerId: string) {
    const link = this.links.get(peerId);
    link?.r?.close();
    link?.u?.close();
  }

  disconnect(notify = true): void {
    for (const l of this.links.values()) {
      l.r?.close();
      l.u?.close();
    }
    this.links.clear();
    this.peer?.destroy();
    this.peer = undefined;
    this.hostId = '';
    this.zone.run(() => {
      this.myPeerId.set(null);
      this.role.set(null);
      this.peerCount.set(0);
    });
    if (notify) this.setStatus('Нет соединения');
  }

  ngOnDestroy(): void {
    this.disconnect(false);
  }

  private setStatus(status: string): void {
    this.zone.run(() => {
      this.status.set(status);
      this.handlers.onStatus?.(status);
    });
  }
}
