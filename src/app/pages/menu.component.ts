import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { QrCodeComponent } from '../components/qr-code.component';
import { COLORS } from '../game/constants';
import { WEAPON_COUNT } from '../game/weapons';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

@Component({
  selector: 'app-menu',
  imports: [FormsModule, QrCodeComponent],
  template: `
    <main class="page">
      <header class="text-center">
        <h1 class="logo">РОБО<span>АРЕНА</span> 2D</h1>
        <p class="mt-1 text-sm text-white/60">Динамичная арена роботов · {{ weaponCount }} видов оружия · игра по сети без серверов</p>
      </header>

      <section class="card mt-5">
        <label class="label" for="name">Твоё имя</label>
        <input id="name" class="field" maxlength="16" [ngModel]="session.name()" (ngModelChange)="session.name.set($event)" (blur)="session.save()" autocomplete="nickname" />
        <div class="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Цвет робота">
          @for (c of colors; track c) {
            <button type="button" class="swatch" [class.on]="session.color() === c" [style.background]="c" (click)="pickColor(c)" [attr.aria-label]="'Цвет ' + c" [attr.aria-checked]="session.color() === c" role="radio"></button>
          }
        </div>
      </section>

      <nav class="mt-4 grid gap-3 sm:grid-cols-2">
        <button type="button" class="btn btn-primary big" (click)="go('/host', 'online')">🛰️ Создать комнату<small>друзья подключатся по QR-коду</small></button>
        <button type="button" class="btn btn-accent big" (click)="go('/join')">📷 Подключиться<small>сканировать QR или ввести код</small></button>
        <button type="button" class="btn big" (click)="go('/host', 'lan')">📶 Без интернета<small>по Wi-Fi или точке доступа · обмен QR-кодами</small></button>
        <button type="button" class="btn big" (click)="go('/host', 'offline')">🤖 С ботами<small>одиночная тренировка</small></button>
      </nav>

      <section class="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          🔊
          <input type="range" min="0" max="1" step="0.05" [ngModel]="audio.volume()" (ngModelChange)="audio.setVolume(+$event)" aria-label="Громкость" />
        </label>
        <button type="button" class="btn small" (click)="audio.toggleMute()">{{ audio.isMuted() ? 'Звук выкл' : 'Звук вкл' }}</button>
        @if (pwa.canInstall()) {
          <button type="button" class="btn small btn-accent" (click)="pwa.install()">⬇ Установить приложение</button>
        }
        <button type="button" class="btn small" (click)="shareOpen.set(true)">📲 Поделиться игрой</button>
        <button type="button" class="btn small" (click)="help.set(!help())">❔ Управление</button>
      </section>

      @if (shareOpen()) {
        <div class="fixed inset-0 z-20 grid place-items-center overflow-auto bg-black/60 p-3 backdrop-blur-sm" (click)="shareOpen.set(false)">
          <section class="card w-full max-w-xs text-center" (click)="$event.stopPropagation()" aria-label="Поделиться игрой">
            <h2 class="text-lg font-extrabold">Поделиться игрой</h2>
            <p class="mt-1 text-sm text-white/70">Наведите камеру телефона — откроется игра, её можно установить как приложение.</p>
            <div class="mt-3 flex justify-center"><app-qr-code [text]="appUrl" [size]="qrSize" /></div>
            <p class="mt-2 break-all text-xs text-white/50">{{ appUrl }}</p>
            @if (isLocal) {
              <p class="mt-2 text-xs text-orange-300">Это локальный адрес — с других устройств он не откроется. Поделитесь ссылкой с опубликованного сайта.</p>
            }
            <div class="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" class="btn small" (click)="copyLink()">{{ copied() ? '✓ Скопировано' : '📋 Копировать' }}</button>
              @if (canShare) {
                <button type="button" class="btn small" (click)="shareLink()">📤 Отправить</button>
              }
              <button type="button" class="btn small" (click)="shareOpen.set(false)">Закрыть</button>
            </div>
          </section>
        </div>
      }

      @if (help()) {
        <section class="card mt-3 text-sm leading-relaxed text-white/80">
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <b class="text-white">Клавиатура и мышь</b><br />
              A / D — бег · W / Пробел / ПКМ — прыжок (двойной в воздухе, от стены)<br />
              S — спрыгнуть с платформы · ЛКМ — огонь<br />
              Колесо, Q / E, 1–0 — смена оружия · Tab — таблица · Esc — меню
            </div>
            <div>
              <b class="text-white">Телефон</b><br />
              Большой палец слева — бег; отклони вверх — прыжок, ещё раз — двойной<br />
              Большой палец справа — прицел, отклони за внутреннее кольцо — огонь (прицел сам подтягивается к врагам)<br />
              Стики работают у краёв экрана — центр свободен, робота видно всегда<br />
              ◀ ▶ — смена оружия · ⤒ — запасная кнопка прыжка · ☰ — меню
            </div>
          </div>
          <p class="mt-3 text-white/60">Ракетой можно взлетать (ракетный прыжок), ящики и стены из дерева, кирпича и стекла разрушаются, бочки взрываются. Выбитый робот лопается конфетти и тут же возвращается в бой.</p>
        </section>
      }

      <footer class="mt-8 text-center text-xs text-white/30">Игру сделал Boris Titarenko</footer>
    </main>
  `,
})
export class MenuComponent {
  protected readonly session = inject(GameSessionService);
  protected readonly audio = inject(AudioService);
  protected readonly pwa = inject(PwaService);
  private readonly sfx = inject(SfxService);
  private readonly router = inject(Router);
  protected readonly colors = COLORS;
  protected readonly weaponCount = WEAPON_COUNT;
  protected readonly help = signal(false);
  protected readonly shareOpen = signal(false);
  protected readonly copied = signal(false);
  /** Адрес самого приложения (без маршрута), чтобы QR вёл на главную. */
  protected readonly appUrl = location.href.split('#')[0];
  protected readonly isLocal = /^(localhost|127\.|192\.168\.|10\.|0\.0\.0\.0)/.test(location.hostname);
  protected readonly canShare = typeof navigator.share === 'function';
  protected readonly qrSize = Math.min(220, Math.round(window.innerHeight * 0.45));

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.appUrl);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* нет доступа к буферу обмена */
    }
  }

  async shareLink() {
    try {
      await navigator.share({ title: 'Робо-Арена 2D', text: 'Попробуй игру «Робо-Арена 2D»!', url: this.appUrl });
    } catch {
      /* отменено пользователем */
    }
  }

  pickColor(c: string) {
    this.session.color.set(c);
    this.session.save();
    this.audio.play('click');
  }

  go(path: string, mode?: string) {
    this.sfx.unlock();
    this.audio.play('click');
    this.session.save();
    void this.router.navigate([path], mode ? { queryParams: { mode } } : {});
  }
}
