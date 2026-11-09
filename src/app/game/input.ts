export interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export interface TouchButton {
  key: 'jump' | 'next' | 'prev';
  x: number;
  y: number;
  r: number;
  label: string;
  down: boolean;
  id: number;
}

/** Доля ширины экрана у каждого края, где можно «взять» стик. Центр остаётся для обзора. */
const ZONE = 0.38;
/** Верхняя часть экрана — HUD и кнопки, стики там не создаются. */
const ZONE_TOP = 0.28;

/** Клавиатура, мышь и сенсорное управление. */
export class InputManager {
  /** Радиус стика (зависит от размера экрана). */
  stickR = 60;
  /** Места «по умолчанию» для стиков — там рисуются подсказки. */
  homeL = { x: 0, y: 0 };
  homeR = { x: 0, y: 0 };
  /** Прыжок левым стиком с гистерезисом: повторное отклонение вверх — двойной прыжок. */
  private stickJump = false;
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  touchMode = false;
  left: Stick | null = null;
  right: Stick | null = null;
  buttons: TouchButton[] = [];
  private weaponDelta = 0;
  private slot: number | null = null;
  showScores = false;
  /** Последний угол прицела с тач-стика. */
  touchAim = 0;
  private hasTouchAim = false;
  onMenu?: () => void;

  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(private el: HTMLCanvasElement) {
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    const on = <K extends string>(t: EventTarget, type: K, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.listeners.push([t, type, fn as EventListener, opts]);
    };
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    on(window, 'blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    on(el, 'mousemove', (e: MouseEvent) => {
      this.mouseX = e.offsetX;
      this.mouseY = e.offsetY;
    });
    on(el, 'mousedown', (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.keys.add('Mouse2');
      this.touchMode = false;
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.keys.delete('Mouse2');
    });
    on(el, 'contextmenu', (e: Event) => e.preventDefault());
    on(el, 'wheel', (e: WheelEvent) => {
      this.weaponDelta += e.deltaY > 0 ? 1 : -1;
      e.preventDefault();
    }, { passive: false });
    on(el, 'touchstart', (e: TouchEvent) => this.onTouch(e, 'start'), { passive: false });
    on(el, 'touchmove', (e: TouchEvent) => this.onTouch(e, 'move'), { passive: false });
    on(el, 'touchend', (e: TouchEvent) => this.onTouch(e, 'end'), { passive: false });
    on(el, 'touchcancel', (e: TouchEvent) => this.onTouch(e, 'end'), { passive: false });
  }

  destroy() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
  }

  layout(w: number, h: number) {
    const s = Math.min(1.25, Math.max(0.8, Math.min(w, h) / 420));
    this.stickR = 56 * s;
    const R = this.stickR;
    this.homeL = { x: R + 34 * s, y: h - R - 28 * s };
    this.homeR = { x: w - R - 34 * s, y: h - R - 28 * s };
    // В вертикальном режиме экран узкий — кнопки оружия на строку ниже, чтобы не наезжать на таймер.
    const wy = w < h ? 96 * s : 34 * s;
    const prevDown = new Map(this.buttons.map((b) => [b.key, b]));
    this.buttons = [
      // Запасная кнопка прыжка — над правым стиком (основной прыжок: левый стик вверх).
      { key: 'jump', x: this.homeR.x, y: this.homeR.y - R - 52 * s, r: 30 * s, label: '⤒', down: false, id: -1 },
      { key: 'next', x: w - 34 * s, y: wy, r: 24 * s, label: '▶', down: false, id: -1 },
      { key: 'prev', x: w - 176 * s, y: wy, r: 24 * s, label: '◀', down: false, id: -1 },
    ];
    for (const b of this.buttons) {
      const old = prevDown.get(b.key);
      if (old) {
        b.down = old.down;
        b.id = old.id;
      }
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (e.code === 'Tab') {
      this.showScores = down;
      e.preventDefault();
    }
    if (!down) return;
    if (e.code === 'Escape') this.onMenu?.();
    if (e.code === 'KeyQ') this.weaponDelta--;
    if (e.code === 'KeyE') this.weaponDelta++;
    const m = /^Digit(\d)$/.exec(e.code);
    if (m) this.slot = m[1] === '0' ? 9 : Number(m[1]) - 1;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  private onTouch(e: TouchEvent, phase: 'start' | 'move' | 'end') {
    e.preventDefault();
    this.touchMode = true;
    const rect = this.el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const R = this.stickR;
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      if (phase === 'start') {
        const btn = this.buttons.find((b) => Math.hypot(b.x - x, b.y - y) < b.r * 1.3);
        if (btn) {
          btn.down = true;
          btn.id = t.identifier;
          if (btn.key === 'next') this.weaponDelta++;
          if (btn.key === 'prev') this.weaponDelta--;
          continue;
        }
        // Стики — только у краёв и не в верхней полосе: палец не закрывает робота в центре.
        if (y < h * ZONE_TOP) continue;
        if (x < w * ZONE && !this.left) this.left = { id: t.identifier, ox: x, oy: y, x, y };
        else if (x > w * (1 - ZONE) && !this.right) this.right = { id: t.identifier, ox: x, oy: y, x, y };
      } else if (phase === 'move') {
        for (const s of [this.left, this.right]) {
          if (s && s.id === t.identifier) {
            s.x = x;
            s.y = y;
            // «Плавающий» центр стика догоняет палец при большом отклонении,
            // но не выезжает из своей зоны к центру экрана.
            const dx = s.x - s.ox;
            const dy = s.y - s.oy;
            const d = Math.hypot(dx, dy);
            if (d > R * 1.5) {
              s.ox = s.x - (dx / d) * R * 1.5;
              s.oy = s.y - (dy / d) * R * 1.5;
            }
            if (s === this.left) s.ox = Math.min(s.ox, w * ZONE);
            else s.ox = Math.max(s.ox, w * (1 - ZONE));
          }
        }
      } else {
        for (const b of this.buttons) if (b.id === t.identifier) {
          b.down = false;
          b.id = -1;
        }
        if (this.left?.id === t.identifier) this.left = null;
        if (this.right?.id === t.identifier) this.right = null;
      }
    }
  }

  stickVec(s: Stick | null) {
    if (!s) return { x: 0, y: 0, len: 0 };
    const dx = (s.x - s.ox) / this.stickR;
    const dy = (s.y - s.oy) / this.stickR;
    const len = Math.min(1.5, Math.hypot(dx, dy));
    return { x: dx, y: dy, len };
  }

  /** Состояние управления на текущий кадр. aimFromMouse — угол на курсор. */
  read(aimFromMouse: number) {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let jump = k.has('KeyW') || k.has('Space') || k.has('ArrowUp') || k.has('Mouse2');
    let down = k.has('KeyS') || k.has('ArrowDown');
    let fire = this.mouseDown || k.has('KeyF') || k.has('ControlLeft');
    let aim = aimFromMouse;
    /** Прицел задан пальцем — движок может помочь автоприцелом. */
    let touchAiming = false;

    if (this.touchMode) {
      const l = this.stickVec(this.left);
      if (Math.abs(l.x) > 0.18) mx = Math.max(-1, Math.min(1, l.x * 1.5));
      // Прыжок: стик вверх. Чтобы сделать двойной — чуть отпустить и снова вверх.
      if (l.y < -0.55 && l.len > 0.5) this.stickJump = true;
      else if (l.y > -0.3) this.stickJump = false;
      if (this.stickJump) jump = true;
      if (l.y > 0.65 && Math.abs(l.x) < 0.6) down = true;
      if (this.buttons.find((b) => b.key === 'jump')?.down) jump = true;
      const r = this.stickVec(this.right);
      if (r.len > 0.25) {
        this.touchAim = Math.atan2(r.y, r.x);
        this.hasTouchAim = true;
        touchAiming = true;
      }
      if (this.hasTouchAim) aim = this.touchAim;
      if (r.len > 0.5) fire = true;
    }
    return { mx, jump, down, fire, aim, touchAiming };
  }

  takeWeaponDelta() {
    const d = this.weaponDelta;
    this.weaponDelta = 0;
    return d;
  }

  takeSlot() {
    const s = this.slot;
    this.slot = null;
    return s;
  }
}
