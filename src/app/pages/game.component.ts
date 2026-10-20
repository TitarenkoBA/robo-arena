import { AfterViewInit, Component, ElementRef, OnDestroy, computed, effect, inject, isDevMode, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { QrCodeComponent } from '../components/qr-code.component';
import { GameEngine, UiState } from '../game/engine';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { PeerJsService } from '../services/peerjs.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

@Component({
  selector: 'app-game',
  imports: [FormsModule, QrCodeComponent],
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

          @if (role === 'host' && code()) {
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
        <p class="mt-2 font-bold">Поверните телефон горизонтально</p>
        <p class="mt-1 text-sm text-white/60">Так удобнее управлять двумя стиками.</p>
        <button type="button" class="btn small mt-3" (click)="rotateDismissed.set(true)">Играть так</button>
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

  ngAfterViewInit() {
    // Перезагрузили страницу на /play без соединения — назад в меню.
    if ((this.role === 'client' && this.peer.role() !== 'guest') || (this.role === 'host' && this.peer.role() !== 'host')) {
      void this.router.navigate(['/']);
      return;
    }
    this.engine = new GameEngine({
      canvas: this.canvas().nativeElement,
      role: this.role,
      settings: this.session.settings(),
      name: this.session.name(),
      color: this.session.color(),
      peer: this.peer,
      sfx: this.sfx,
      onUi: (s) => this.ui.set(s),
      onMenu: () => this.toggleMenu(),
    });
    // Отладочный доступ к движку из консоли (только в dev-сборке).
    if (isDevMode()) (window as unknown as { __robo: unknown }).__robo = this.engine;
  }

  ngOnDestroy() {
    this.engine?.destroy();
    this.engine = null;
  }

  unlock() {
    this.sfx.unlock();
  }

  constructor() {
    // В одиночной игре открытое меню ставит паузу.
    effect(() => {
      const open = this.menu();
      if (this.engine && this.role === 'offline') this.engine.paused = open;
    });
  }

  toggleMenu() {
    this.menu.update((v) => !v);
  }

  exit() {
    this.audio.play('click');
    this.engine?.destroy();
    this.engine = null;
    this.peer.disconnect(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    void this.router.navigate(['/']);
  }
}
