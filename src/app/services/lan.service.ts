import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { MessageBuffer, PeerHandlers, Transport, TransportRole } from './transport';

/**
 * Офлайн-режим: WebRTC без сигнального сервера.
 *
 * Знакомство устройств — обменом двумя QR-кодами:
 *   1) хост показывает QR «приглашение» (SDP offer), гость сканирует;
 *   2) гость показывает QR «ответ» (SDP answer), хост сканирует.
 * После этого игра идёт напрямую по локальной сети (Wi-Fi или точка доступа
 * с телефона). Интернет не нужен: без него ICE собирает только локальные адреса.
 */

const PAYLOAD_VERSION = 1;
/** Сколько ждать сбора ICE-кандидатов (без трикла — все кандидаты едут в QR). */
const GATHER_TIMEOUT = 2500;

interface Payload {
  v: number;
  /** Номер приглашения — ответ гостя ссылается на него. */
  i: string;
  t: 'o' | 'a';
  s: string;
}

interface Link {
  pc: RTCPeerConnection;
  r: RTCDataChannel;
  u: RTCDataChannel;
  joined: boolean;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Убираем из SDP то, что не нужно в локальной сети, чтобы QR был меньше. */
function slimSdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter((l) => !(l.startsWith('a=candidate') && / tcp /i.test(l)))
    .join('\r\n');
}

/** Полный формат (запасной): весь SDP, сжатый deflate. */
export function encodePayload(p: Payload): string {
  return toB64Url(deflateSync(strToU8(JSON.stringify(p)), { level: 9 }));
}

// ---------------------------------------------------------------- компактный формат
//
// Из SDP канала данных нужны лишь: ключи ICE, отпечаток DTLS, роль DTLS, mid и
// адреса-кандидаты. Передаём только их (~250 символов вместо ~750), а SDP
// собираем обратно по шаблону. QR получается в 2–3 раза проще — сканируется
// даже слабой камерой и с расстояния.

const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function packAddr(a: string): string {
  const m = UUID_LOCAL.exec(a);
  if (!m) return a;
  const hex = m.slice(1).join('');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return '@' + toB64Url(bytes);
}

function unpackAddr(a: string): string {
  if (!a.startsWith('@')) return a;
  const b = fromB64Url(a.slice(1));
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}

interface SdpParts {
  ufrag: string;
  pwd: string;
  fp: Uint8Array;
  setup: string;
  mid: string;
  cands: { typ: string; addr: string; port: string; raddr?: string; rport?: string }[];
}

function parseSdp(sdp: string): SdpParts | null {
  const get = (re: RegExp) => re.exec(sdp)?.[1]?.trim();
  const ufrag = get(/a=ice-ufrag:(\S+)/);
  const pwd = get(/a=ice-pwd:(\S+)/);
  const fpHex = get(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/);
  const setup = get(/a=setup:(\S+)/) ?? 'actpass';
  const mid = get(/a=mid:(\S+)/) ?? '0';
  if (!ufrag || !pwd || !fpHex) return null;
  const fp = new Uint8Array(fpHex.split(':').map((h) => parseInt(h, 16)));
  const cands: SdpParts['cands'] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const m = /^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)(?: raddr (\S+) rport (\d+))?/i.exec(line);
    if (m) cands.push({ addr: m[1], port: m[2], typ: m[3], raddr: m[4], rport: m[5] });
  }
  return { ufrag, pwd, fp, setup, mid, cands };
}

function buildSdp(p: SdpParts, type: 'offer' | 'answer'): string {
  const fpHex = [...p.fp].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
  const lines = [
    'v=0',
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${p.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  p.cands.forEach((c, i) => {
    const prio = c.typ === 'host' ? 2122260223 - i : 1686052607 - i;
    const rel = c.typ === 'srflx' ? ` raddr ${c.raddr ?? '0.0.0.0'} rport ${c.rport ?? '0'}` : '';
    lines.push(`a=candidate:${i + 1} 1 udp ${prio} ${c.addr} ${c.port} typ ${c.typ}${rel} generation 0`);
  });
  lines.push(
    'a=end-of-candidates',
    `a=ice-ufrag:${p.ufrag}`,
    `a=ice-pwd:${p.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fpHex}`,
    `a=setup:${type === 'offer' ? 'actpass' : p.setup === 'actpass' ? 'active' : p.setup}`,
    `a=mid:${p.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  );
  return lines.join('\r\n');
}

/** Компактная строка для QR. Формат: c + base64url("2~t~id~mid~setup~ufrag~pwd~fp~кандидаты"). */
function encodeCompact(t: 'o' | 'a', id: string, sdp: string): string | null {
  const p = parseSdp(sdp);
  if (!p || !p.cands.length) return null;
  const cands = p.cands
    .map((c) => [c.typ === 'host' ? 'h' : 's', packAddr(c.addr), c.port, ...(c.typ === 'srflx' ? [c.raddr ?? '', c.rport ?? ''] : [])].join(','))
    .join('*');
  const s = ['2', t, id, p.mid, p.setup, p.ufrag, p.pwd, toB64Url(p.fp), cands].join('~');
  return 'c' + toB64Url(strToU8(s));
}

function decodeCompact(raw: string): Payload | null {
  if (!raw.startsWith('c')) return null;
  try {
    const f = strFromU8(fromB64Url(raw.slice(1))).split('~');
    if (f[0] !== '2' || f.length < 9) return null;
    const [, t, id, mid, setup, ufrag, pwd, fp, cands] = f;
    const parts: SdpParts = {
      ufrag, pwd, setup, mid, fp: fromB64Url(fp),
      cands: cands.split('*').filter(Boolean).map((c) => {
        const [k, addr, port, raddr, rport] = c.split(',');
        return { typ: k === 's' ? 'srflx' : 'host', addr: unpackAddr(addr), port, raddr, rport };
      }),
    };
    if (t !== 'o' && t !== 'a') return null;
    return { v: PAYLOAD_VERSION, i: id, t, s: buildSdp(parts, t === 'o' ? 'offer' : 'answer') };
  } catch {
    return null;
  }
}

/** Строка для QR: компактная, а если SDP необычный — полная. */
export function makePayload(t: 'o' | 'a', id: string, sdp: string): string {
  return encodeCompact(t, id, sdp) ?? encodePayload({ v: PAYLOAD_VERSION, i: id, t, s: slimSdp(sdp) });
}

export function decodePayload(text: string): Payload {
  let raw = text.trim();
  const m = /#\/lan\/([A-Za-z0-9_-]+)/.exec(raw);
  if (m) raw = m[1];
  raw = raw.replace(/^RA:/, '');
  const compact = decodeCompact(raw);
  if (compact) return compact;
  let p: Payload;
  try {
    p = JSON.parse(strFromU8(inflateSync(fromB64Url(raw)))) as Payload;
  } catch {
    throw new Error('Не удалось прочитать QR-код. Это код из «Робо-Арены»?');
  }
  if (p.v !== PAYLOAD_VERSION || !p.s || !p.i) throw new Error('Неподходящий QR-код');
  return p;
}

function rtcConfig(): RTCConfiguration {
  // Если интернет есть — добавим STUN: тогда QR-режим работает и между разными сетями.
  return { iceServers: navigator.onLine ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] };
}

function waitGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, GATHER_TIMEOUT);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        window.clearTimeout(t);
        resolve();
      }
    });
  });
}

/** Каналы создаются «договорённо» с фиксированными id — одинаково у обеих сторон. */
function openChannels(pc: RTCPeerConnection) {
  const r = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
  const u = pc.createDataChannel('u', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
  return { r, u };
}

@Injectable({ providedIn: 'root' })
export class LanService implements OnDestroy, Transport {
  private readonly zone = inject(NgZone);
  private links = new Map<string, Link>();
  private pending = new Map<string, Link>();
  private handlers: PeerHandlers = {};
  private readonly inbox = new MessageBuffer();
  private hostId = 'host';
  private inviteSeq = 0;

  readonly role = signal<TransportRole>(null);
  readonly status = signal('');
  readonly peerCount = signal(0);

  setHandlers(h: PeerHandlers) {
    this.handlers = h;
    this.inbox.setHandler(h.onMessage);
  }

  // ------------------------------------------------------------ хост

  startHost() {
    if (this.role() !== 'host') {
      this.disconnect(false);
      this.role.set('host');
    }
  }

  /** Новое приглашение для очередного игрока. Возвращает строку для QR. */
  async createInvite(): Promise<string> {
    this.startHost();
    // Старые неотвеченные приглашения больше не нужны.
    for (const l of this.pending.values()) l.pc.close();
    this.pending.clear();

    const id = `${Date.now().toString(36)}${(++this.inviteSeq).toString(36)}`;
    const pc = new RTCPeerConnection(rtcConfig());
    const { r, u } = openChannels(pc);
    const link: Link = { pc, r, u, joined: false };
    this.pending.set(id, link);
    this.bind(id, link);
    await pc.setLocalDescription(await pc.createOffer());
    await waitGathering(pc);
    return makePayload('o', id, pc.localDescription!.sdp);
  }

  /** Хост принимает ответ гостя (содержимое его QR). */
  async acceptAnswer(text: string): Promise<void> {
    const p = decodePayload(text);
    if (p.t !== 'a') throw new Error('Это не ответ игрока — отсканируйте QR с экрана гостя');
    const link = this.pending.get(p.i);
    if (!link) throw new Error('Этот ответ относится к старому приглашению. Пусть игрок отсканирует новый QR.');
    this.pending.delete(p.i);
    this.links.set(p.i, link);
    await link.pc.setRemoteDescription({ type: 'answer', sdp: p.s });
    await this.waitOpen(link, 15000);
  }

  // ------------------------------------------------------------ гость

  /** Гость принимает приглашение и получает строку-ответ для QR. */
  async acceptInvite(text: string): Promise<string> {
    const p = decodePayload(text);
    if (p.t !== 'o') throw new Error('Это не приглашение хоста');
    this.disconnect(false);
    this.role.set('guest');
    this.hostId = 'host';
    const pc = new RTCPeerConnection(rtcConfig());
    const { r, u } = openChannels(pc);
    const link: Link = { pc, r, u, joined: false };
    this.links.set(this.hostId, link);
    this.bind(this.hostId, link);
    await pc.setRemoteDescription({ type: 'offer', sdp: p.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitGathering(pc);
    return 'RA:' + makePayload('a', p.i, pc.localDescription!.sdp);
  }

  /** Ждём, пока хост отсканирует ответ и канал откроется. */
  waitConnected(timeoutMs = 300000): Promise<void> {
    const link = this.links.get(this.hostId);
    if (!link) return Promise.reject(new Error('Нет приглашения'));
    return this.waitOpen(link, timeoutMs);
  }

  // ------------------------------------------------------------ общее

  private waitOpen(link: Link, timeoutMs: number): Promise<void> {
    if (link.r.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('Не удалось соединиться. Устройства в одной сети Wi-Fi?')), timeoutMs);
      link.r.addEventListener('open', () => {
        window.clearTimeout(t);
        resolve();
      });
      link.pc.addEventListener('connectionstatechange', () => {
        if (link.pc.connectionState === 'failed') {
          window.clearTimeout(t);
          reject(new Error('Соединение не установлено. Проверьте, что устройства в одной сети и сеть не гостевая.'));
        }
      });
    });
  }

  private bind(id: string, link: Link) {
    link.r.addEventListener('open', () => {
      if (link.joined) return;
      link.joined = true;
      this.updateCount();
      this.setStatus(this.role() === 'host' ? 'Игрок подключился' : 'Подключено к хосту');
      if (this.role() === 'host') this.handlers.onJoin?.(id);
    });
    const onData = (e: MessageEvent) => {
      try {
        this.inbox.push(id, JSON.parse(e.data as string));
      } catch {
        /* битое сообщение */
      }
    };
    link.r.addEventListener('message', onData);
    link.u.addEventListener('message', onData);
    const lost = () => {
      if (!link.joined) return;
      link.joined = false;
      this.links.delete(id);
      link.pc.close();
      this.updateCount();
      if (this.role() === 'host') this.handlers.onLeave?.(id);
      else {
        this.setStatus('Хост отключился');
        this.handlers.onHostLost?.();
      }
    };
    link.r.addEventListener('close', lost);
    link.pc.addEventListener('connectionstatechange', () => {
      const s = link.pc.connectionState;
      if (s === 'failed' || s === 'closed') lost();
    });
  }

  private updateCount() {
    this.zone.run(() => this.peerCount.set([...this.links.values()].filter((l) => l.joined).length));
  }

  send(peerId: string, msg: unknown, reliable = true): boolean {
    const link = this.links.get(peerId);
    if (!link) return false;
    const ch = !reliable && link.u.readyState === 'open' ? link.u : link.r;
    if (ch.readyState !== 'open') return false;
    // Не забиваем буфер ненадёжного канала, если сеть не успевает.
    if (!reliable && ch.bufferedAmount > 256 * 1024) return false;
    try {
      ch.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  sendToHost(msg: unknown, reliable = true): boolean {
    return this.send(this.hostId, msg, reliable);
  }

  disconnect(notify = true): void {
    for (const l of [...this.links.values(), ...this.pending.values()]) {
      l.joined = false;
      l.pc.close();
    }
    this.links.clear();
    this.pending.clear();
    this.inbox.clear();
    this.zone.run(() => {
      this.role.set(null);
      this.peerCount.set(0);
    });
    if (notify) this.setStatus('Нет соединения');
  }

  ngOnDestroy(): void {
    this.disconnect(false);
  }

  private setStatus(s: string) {
    this.zone.run(() => {
      this.status.set(s);
      this.handlers.onStatus?.(s);
    });
  }
}
