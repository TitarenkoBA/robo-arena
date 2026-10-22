export interface PeerHandlers {
  onJoin?: (peerId: string) => void;
  onLeave?: (peerId: string) => void;
  onMessage?: (peerId: string, msg: unknown) => void;
  onStatus?: (status: string) => void;
  onHostLost?: () => void;
}

export type TransportRole = 'host' | 'guest' | null;

/**
 * Сетевой транспорт игры. Реализации:
 *  - PeerJsService — через сигнальный сервер PeerJS (нужен интернет на старте);
 *  - LanService — обмен QR-кодами, без сервера и без интернета.
 */
export interface Transport {
  role(): TransportRole;
  setHandlers(h: PeerHandlers): void;
  send(peerId: string, msg: unknown, reliable?: boolean): boolean;
  sendToHost(msg: unknown, reliable?: boolean): boolean;
  disconnect(notify?: boolean): void;
}

/**
 * Сообщения, пришедшие до того, как движок игры подписался (например, гость
 * подключился, пока хост ещё в лобби), не теряются, а доставляются позже.
 */
export class MessageBuffer {
  private queue: [string, unknown][] = [];
  private handler?: (peerId: string, msg: unknown) => void;

  setHandler(h?: (peerId: string, msg: unknown) => void) {
    this.handler = h;
    if (!h) return;
    const q = this.queue;
    this.queue = [];
    for (const [id, m] of q) h(id, m);
  }

  push(peerId: string, msg: unknown) {
    if (this.handler) this.handler(peerId, msg);
    else if (this.queue.length < 500) this.queue.push([peerId, msg]);
  }

  clear() {
    this.queue = [];
  }
}
