import { TILE } from './constants';
import { T, TILE_INFO, TileMap } from './tiles';

export type EdgeKind = 'walk' | 'fall' | 'jump' | 'drop' | 'pad';

export interface NavEdge {
  to: number;
  kind: EdgeKind;
  cost: number;
}

/**
 * Граф проходимости: узел — клетка, в которой можно стоять
 * (сама пустая, под ней опора, сверху есть место для роста).
 * Рёбра: ходьба, падение с края, прыжок (с учётом двойного прыжка),
 * спрыгивание сквозь платформу и полёт с прыжковой площадки.
 */
export class NavGraph {
  readonly nodes = new Map<number, NavEdge[]>();
  readonly version: number;

  constructor(private map: TileMap) {
    this.version = map.version;
    this.build();
  }

  private free(cx: number, cy: number) {
    return !TILE_INFO[this.map.get(cx, cy)].solid;
  }

  isNode(cx: number, cy: number) {
    if (cx < 1 || cx >= this.map.w - 1 || cy < 1 || cy >= this.map.h) return false;
    return this.free(cx, cy) && this.free(cx, cy - 1) && this.map.isStandable(cx, cy + 1) &&
      this.map.get(cx, cy) !== T.PLATFORM;
  }

  private build() {
    const m = this.map;
    for (let cy = 1; cy < m.h; cy++) {
      for (let cx = 1; cx < m.w - 1; cx++) {
        if (this.isNode(cx, cy)) this.nodes.set(m.idx(cx, cy), []);
      }
    }
    for (const [i, edges] of this.nodes) {
      const cx = i % m.w;
      const cy = Math.floor(i / m.w);
      const add = (tx: number, ty: number, kind: EdgeKind, cost: number) => {
        const j = m.idx(tx, ty);
        if (j !== i && this.nodes.has(j) && !edges.some((e) => e.to === j)) edges.push({ to: j, kind, cost });
      };
      const onPad = m.get(cx, cy + 1) === T.JUMPPAD;

      for (const dir of [-1, 1]) {
        const nx = cx + dir;
        if (this.isNode(nx, cy)) add(nx, cy, 'walk', 1);
        else if (this.free(nx, cy) && this.free(nx, cy - 1)) {
          // Падение с края
          for (let y = cy + 1; y < Math.min(m.h, cy + 20); y++) {
            if (!this.free(nx, y)) break;
            if (this.isNode(nx, y)) {
              add(nx, y, 'fall', 1 + (y - cy) * 0.3);
              break;
            }
          }
        }
      }
      // Спрыгнуть через платформу
      if (m.get(cx, cy + 1) === T.PLATFORM) {
        for (let y = cy + 2; y < Math.min(m.h, cy + 20); y++) {
          if (!this.free(cx, y)) break;
          if (this.isNode(cx, y)) {
            add(cx, y, 'drop', 1.5 + (y - cy) * 0.3);
            break;
          }
        }
      }
      // Прыжки
      const maxUp = onPad ? 13 : 7;
      const maxSide = onPad ? 6 : 5;
      for (let dy = -maxUp; dy <= 1; dy++) {
        for (let dx = -maxSide; dx <= maxSide; dx++) {
          if (dx === 0 && dy >= 0) continue;
          if (Math.abs(dx) === 1 && dy === 0) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!this.nodes.has(m.idx(tx, ty))) continue;
          if (dy >= 0 && Math.abs(dx) < 2) continue;
          // Высокие прыжки — только почти вертикально.
          if (!onPad && dy < -4 && Math.abs(dx) > 3) continue;
          if (!this.jumpClear(cx, cy, tx, ty)) continue;
          add(tx, ty, onPad ? 'pad' : 'jump', 2 + Math.abs(dx) * 0.4 + Math.abs(dy) * 0.5 - (onPad ? 1.5 : 0));
        }
      }
    }
  }

  /** Грубая проверка траектории: колонна над стартом и прямая к цели свободны. */
  private jumpClear(cx: number, cy: number, tx: number, ty: number) {
    const m = this.map;
    const top = Math.min(cy, ty) - 1;
    for (let y = cy - 1; y >= top; y--) if (!this.free(cx, y)) return false;
    const x0 = cx * TILE + TILE / 2;
    const y0 = top * TILE + TILE / 2;
    const x1 = tx * TILE + TILE / 2;
    const y1 = ty * TILE + TILE / 2;
    if (m.raycast(x0, y0, x1, y1)) return false;
    if (m.raycast(x0, y0 - TILE * 0.4, x1, y1 - TILE * 0.6)) return false;
    return true;
  }

  /** Ближайший узел к точке мира (ищем вниз и по сторонам). */
  nearestNode(px: number, py: number): number {
    const m = this.map;
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    for (let r = 0; r < 8; r++) {
      for (let dy = 0; dy <= r + 4; dy++) {
        for (const dx of r === 0 ? [0] : [-r, r]) {
          const i = m.idx(cx + dx, cy + dy);
          if (this.nodes.has(i)) return i;
        }
      }
    }
    return -1;
  }

  /** A* по графу. Возвращает список индексов узлов (без стартового). */
  path(from: number, to: number, limit = 4000): { node: number; kind: EdgeKind }[] | null {
    if (from < 0 || to < 0 || !this.nodes.has(from) || !this.nodes.has(to)) return null;
    if (from === to) return [];
    const w = this.map.w;
    const tx = to % w;
    const ty = Math.floor(to / w);
    const h = (i: number) => Math.abs((i % w) - tx) + Math.abs(Math.floor(i / w) - ty) * 0.7;
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, { prev: number; kind: EdgeKind }>();
    const open = new MinHeap();
    open.push(from, h(from));
    const closed = new Set<number>();
    let iter = 0;
    while (open.size && iter++ < limit) {
      const cur = open.pop();
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = g.get(cur)!;
      for (const e of this.nodes.get(cur)!) {
        const ng = gc + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          came.set(e.to, { prev: cur, kind: e.kind });
          open.push(e.to, ng + h(e.to));
        }
      }
    }
    if (!came.has(to)) return null;
    const out: { node: number; kind: EdgeKind }[] = [];
    let c = to;
    while (c !== from) {
      const s = came.get(c)!;
      out.push({ node: c, kind: s.kind });
      c = s.prev;
    }
    return out.reverse();
  }

  randomNode(): number {
    const keys = [...this.nodes.keys()];
    return keys[Math.floor(Math.random() * keys.length)] ?? -1;
  }
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    this.k.push(key);
    this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par] <= this.p[i]) break;
      this.swap(i, par);
      i = par;
    }
  }
  pop(): number {
    const top = this.k[0];
    const lk = this.k.pop()!;
    const lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.p[a], this.p[b]] = [this.p[b], this.p[a]];
  }
}
