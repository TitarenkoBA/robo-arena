import { AfterViewInit, Component, ElementRef, OnDestroy, computed, effect, inject, isDevMode, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LanInviteComponent } from '../components/lan-invite.component';
import { QrCodeComponent } from '../components/qr-code.component';
import { LanService } from '../services/lan.service';
import { Transport } from '../services/transport';
import { GameEngine, UiState } from '../game/engine';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { PeerJsService } from '../services/peerjs.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

@Component({
  selector: 'app-game',
  imports: [FormsModule, QrCodeComponent, LanInviteComponent],
  host: { class: 'fixed inset-0 block overflow-hidden bg-[#141a2e] select-none' },
  styles: `
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; display: block; }
    .menu-btn { position: absolute; left: 8px; top: 8px; width: 40px; height: 40px; border-radius: 12px;
      background: rgba(0,0,0,.4); color: #fff; font-size: 20px; border: 1px solid rgba(255,255,255,.15); z-index: 5; }
    .overlay { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; background: rgba(8,10,20,.6);
      backdrop-filter: blur(3px); padding: 12px; overflow: auto; }
    .rotate { display: none; }
    @media (orientation: portrait) and (pointer: coarse) { .rotate.show { display: grid; } }
  `,
  template: `
    <canvas #canvas (pointerdown)="unlock()"></canvas>
    <button type="button" class="menu-btn" (click)="toggleMenu()" aria-label="Меню">☰</button>

    @if (menu()) {
      <div class="overlay" (click)="menu.set(false)">
        <div class="card w-full max-w-md" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-extrabold">{{ role === 'client' ? 'Сетевая игра' : role === 'host' ? 'Ваша комната' : 'Тренировка' }}</h2>
            <button type="button" class="btn small" (click)="menu.set(false)">✕</button>
          </div>

          @if (role === 'host' && net === 'lan') {
            <div class="mt-3 rounded-xl bg-black/20 p-2">
              @if (inviteOpen()) {
                <app-lan-invite [compact]="true" />
                <button type="button" class="btn small mt-2 w-full" (click)="inviteOpen.set(false)">Скрыть приглашение</button>
              } @else {
                <button type="button" class="btn small w-full" (click)="inviteOpen.set(true)">📶 Пригласить игрока (без интернета) · в игре: {{ lan.peerCount() }}</button>
              }
            </div>
          }

          @if (role === 'host' && net === 'online' && code()) {
            <div class="mt-3 flex items-center gap-3">
              <app-qr-code [text]="invite()" [size]="110" />
              <div>
                <p class="text-xs text-white/60">Код комнаты</p>
                <p class="font-mono text-2xl font-black tracking-widest text-emerald-300">{{ code() }}</p>
                <p class="text-xs text-white/60">Онлайн: {{ peer.peerCount() }}</p>
              </div>
            </div>
          }

          <div class="mt-3 max-h-40 overflow-auto rounded-xl bg-black/20 p-2 text-sm">
            @for (r of ui().roster; track r.id) {
              <div class="flex justify-between py-0.5">
                <span [style.color]="r.color">{{ r.name }}{{ r.bot ? ' 🤖' : '' }}{{ r.id === ui().myId ? ' (ты)' : '' }}</span>
                <span class="text-white/70">{{ r.frags }} / {{ r.deaths }}</span>
              </div>
            }
          </div>

          @if (role !== 'client') {
            <div class="mt-3 grid grid-cols-3 gap-2">
              <button type="button" class="btn small" (click)="engine?.addBot()">+ Бот</button>
              <button type="button" class="btn small" [disabled]="ui().bots === 0" (click)="engine?.removeBot()">− Бот</button>
              <button type="button" class="btn small" (click)="engine?.restartMatch(); menu.set(false)">⟳ Раунд</button>
            </div>
          }

          <div class="mt-3 flex items-center gap-3 text-sm">
            🔊 <input type="range" class="flex-1" min="0" max="1" step="0.05" [ngModel]="audio.volume()" (ngModelChange)="audio.setVolume(+$event)" aria-label="Громкость" />
            <button type="button" class="btn small" (click)="audio.toggleMute()">{{ audio.isMuted() ? '🔇' : '🔈' }}</button>
            <button type="button" class="btn small" (click)="pwa.toggleFullscreen()">⛶</button>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <button type="button" class="btn btn-primary" (click)="menu.set(false)">Продолжить</button>
            <button type="button" class="btn" (click)="exit()">Выйти</button>
          </div>
        </div>
      </div>
    }

    @if (!ui().connected) {
      <div class="overlay">
        <div class="card max-w-sm text-center">
          <p class="text-lg font-bold">Связь с хостом потеряна</p>
          <p class="mt-1 text-sm text-white/60">Возможно, создатель комнаты вышел из игры.</p>
          <button type="button" class="btn btn-primary mt-4 w-full" (click)="exit()">В меню</button>
        </div>
      </div>
    }

    <div class="overlay rotate" [class.show]="!rotateDismissed()">
      <div class="card max-w-xs text-center">
        <p class="text-5xl">📱↻</p>
        <p class="mt-2 font-bold">Играть удобнее горизонтально</p>
        <p class="mt-1 text-sm text-white/60">Два стика под большими пальцами, а робот — посередине экрана.</p>
        <button type="button" class="btn btn-primary mt-3 w-full" (click)="rotateNow()">↻ Повернуть экран</button>
        @if (rotateFailed()) {
          <p class="mt-2 text-xs text-orange-300">Браузер не даёт повернуть экран сам — поверните телефон (и проверьте, что автоповорот включён).</p>
        }
        <button type="button" class="btn small mt-2" (click)="rotateDismissed.set(true)">Играть вертикально</button>
      </div>
    </div>
  `,
})
export class GameComponent implements AfterViewInit, OnDestroy {
  protected readonly session = inject(GameSessionService);
  protected readonly peer = inject(PeerJsService);
  protected readonly audio = inject(AudioService);
  protected readonly pwa = inject(PwaService);
  private readonly sfx = inject(SfxService);
  private readonly router = inject(Router);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected engine: GameEngine | null = null;
  protected readonly role = this.session.role();
  protected readonly menu = signal(false);
  protected readonly rotateDismissed = signal(false);
  protected readonly ui = signal<UiState>({ phase: 'loading', roster: [], winner: '', myId: -1, connected: true, bots: 0 });
  protected readonly code = this.peer.myPeerId;
  protected readonly invite = computed(() => this.session.inviteUrl(this.code() ?? ''));
  protected readonly lan = inject(LanService);
  protected readonly net = this.session.net();
  protected readonly inviteOpen = signal(false);
  /** Сеть этой игры: PeerJS или офлайн-обмен QR. */
  private readonly transport: Transport = this.net === 'lan' ? this.lan : this.peer;

  ngAfterViewInit() {
    // Перезагрузили страницу на /play без соединения — назад в меню.
    const tr = this.transport.role();
    if ((this.role === 'client' && tr !== 'guest') || (this.role === 'host' && tr !== 'host')) {
      void this.router.navigate(['/']);
      return;
    }
    this.engine = new GameEngine({
      canvas: this.canvas().nativeElement,
      role: this.role,
      settings: this.session.settings(),
      name: this.session.name(),
      color: this.session.color(),
      peer: this.transport,
      sfx: this.sfx,
      onUi: (s) => this.ui.set(s),
      onMenu: () => this.toggleMenu(),
    });
    if (this.role === 'offline') this.engine.paused = this.menu() || (this.portrait() && !this.rotateDismissed());
    // Отладочный доступ к движку из консоли (только в dev-сборке).
    if (isDevMode()) Object.assign(window, { __robo: this.engine, __lan: this.lan });
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.onOrientation);
    this.engine?.destroy();
    this.engine = null;
    // Меню снова вертикальное.
    void this.pwa.exitGameMode();
  }

  unlock() {
    this.sfx.unlock();
    // Первое касание — жест пользователя: можно включить полный экран и альбомную ориентацию.
    if (this.pwa.isTouch && !this.rotateDismissed() && (this.pwa.isPortrait() || (!document.fullscreenElement && !this.pwa.isStandalone))) {
      void this.pwa.enterGameMode();
    }
  }

  protected readonly rotateFailed = signal(false);

  async rotateNow() {
    this.sfx.unlock();
    const ok = await this.pwa.enterGameMode();
    // Если поворот не удался (iOS), подсказка остаётся с пояснением.
    setTimeout(() => this.rotateFailed.set(!ok && this.pwa.isPortrait()), 400);
  }

  /** Экран сейчас вертикальный (на телефоне — показываем подсказку повернуть). */
  private readonly portrait = signal(this.pwa.isTouch && this.pwa.isPortrait());
  private readonly onOrientation = () => this.portrait.set(this.pwa.isTouch && this.pwa.isPortrait());

  constructor() {
    // В одиночной игре пауза, пока открыто меню или висит подсказка повернуть телефон.
    effect(() => {
      const blocked = this.menu() || (this.portrait() && !this.rotateDismissed());
      if (this.engine && this.role === 'offline') this.engine.paused = blocked;
    });
    window.addEventListener('resize', this.onOrientation);
  }

  toggleMenu() {
    this.menu.update((v) => !v);
  }

  exit() {
    this.audio.play('click');
    this.engine?.destroy();
    this.engine = null;
    this.transport.disconnect(false);
    void this.router.navigate(['/']);
  }
}
