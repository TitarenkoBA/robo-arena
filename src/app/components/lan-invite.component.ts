import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AudioService } from '../services/audio.service';
import { LanService } from '../services/lan.service';
import { QrCodeComponent } from './qr-code.component';
import { QrScannerComponent } from './qr-scanner.component';

/**
 * Хост в офлайн-режиме: показывает QR-приглашение и сканирует QR-ответ игрока.
 * После каждого подключения готовит новое приглашение для следующего.
 */
@Component({
  selector: 'app-lan-invite',
  imports: [FormsModule, QrCodeComponent, QrScannerComponent],
  template: `
    <div class="text-center">
      @if (!compact()) {
        <ol class="mx-auto mb-3 max-w-sm list-decimal pl-5 text-left text-sm text-white/75">
          <li>Игрок сканирует <b>QR №1</b> (камерой телефона или в игре: «Подключиться»).</li>
          <li>У игрока появится <b>QR №2</b> — нажмите «Сканировать ответ» и наведите камеру на его экран.</li>
          <li>Готово! Для следующего игрока здесь сразу появится новый QR №1.</li>
        </ol>
      }

      @if (scanning()) {
        <p class="mb-2 text-sm font-bold">Наведите камеру на QR №2 с экрана игрока</p>
        <app-qr-scanner (scanned)="accept($event)" />
        <button type="button" class="btn small mt-2" (click)="scanning.set(false)">Отмена</button>
      } @else if (invite(); as inv) {
        <p class="text-xs font-bold uppercase tracking-wide text-emerald-300">QR №1 · приглашение</p>
        <button type="button" class="mx-auto mt-1 block" (click)="big.set(true)" aria-label="Увеличить QR" [attr.data-invite]="inv">
          <app-qr-code [text]="inv" [size]="compact() ? 150 : qrSize" ecl="L" />
        </button>
        <p class="mt-1 text-xs text-white/50">Нажмите на QR, чтобы увеличить</p>
        <button type="button" class="btn btn-primary mt-3 w-full" [disabled]="busy()" (click)="scanning.set(true)">📷 Сканировать ответ игрока (QR №2)</button>
      } @else {
        <div class="spinner mx-auto my-6"></div>
        <p class="text-sm text-white/60">Готовим приглашение…</p>
      }

      @if (!scanning()) {
        <details class="mt-3 text-left text-sm">
          <summary class="cursor-pointer text-white/60">Нет камеры? Вставить код ответа</summary>
          <form class="mt-2 flex gap-2" (ngSubmit)="accept(pasted)">
            <input class="field font-mono text-xs" name="answer" [(ngModel)]="pasted" placeholder="RA:..." autocomplete="off" />
            <button type="submit" class="btn small" [disabled]="!pasted.trim() || busy()">OK</button>
          </form>
        </details>
      }

      @if (busy()) {
        <p class="mt-2 text-sm text-white/70">Соединяемся…</p>
      }
      @if (message()) {
        <p class="mt-2 text-sm text-emerald-300">{{ message() }}</p>
      }
      @if (error()) {
        <p class="mt-2 text-sm text-orange-300">{{ error() }}</p>
      }
      <p class="mt-2 text-sm">Подключено игроков: <b>{{ lan.peerCount() }}</b></p>

      @if (!compact()) {
        <details class="mt-3 text-left text-sm text-white/75">
          <summary class="cursor-pointer text-white/60">Если не подключается</summary>
          <ul class="mt-2 list-disc space-y-1 pl-5">
            <li>Все устройства должны быть в <b>одной</b> сети Wi-Fi. Нет роутера — включите точку доступа на телефоне хоста и подключите к ней остальных.</li>
            <li>Гостевые и публичные Wi-Fi (кафе, гостиницы, школы) часто запрещают устройствам видеть друг друга — используйте точку доступа.</li>
            <li>Игру нужно хотя бы раз открыть <b>с интернетом</b> (лучше — установить как приложение), тогда она запустится и без сети.</li>
            <li>Если QR №2 не сканируется — увеличьте яркость экрана гостя или нажмите у гостя «Копировать код» и вставьте его здесь.</li>
            <li>Ошибка «старое приглашение» — гость отсканировал прежний QR №1; пусть отсканирует текущий.</li>
          </ul>
        </details>
      }
    </div>

    @if (big() && invite()) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-white p-4" (click)="big.set(false)">
        <app-qr-code [text]="invite()!" [size]="bigSize" ecl="L" />
        <p class="absolute bottom-4 text-sm text-black/60">Нажмите, чтобы закрыть</p>
      </div>
    }
  `,
})
export class LanInviteComponent implements OnInit {
  readonly compact = input(false);
  protected readonly lan = inject(LanService);
  private readonly audio = inject(AudioService);
  protected readonly invite = signal<string | null>(null);
  protected readonly scanning = signal(false);
  protected readonly busy = signal(false);
  protected readonly big = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected pasted = '';
  protected readonly qrSize = Math.min(260, Math.round(Math.min(window.innerWidth - 80, window.innerHeight * 0.45)));
  protected readonly bigSize = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.9);

  ngOnInit() {
    this.lan.startHost();
    void this.newInvite();
  }

  private async newInvite() {
    this.invite.set(null);
    try {
      const payload = await this.lan.createInvite();
      // QR — ссылка: камера телефона сразу откроет игру с приглашением.
      this.invite.set(`${location.href.split('#')[0]}#/lan/${payload}`);
    } catch (e) {
      this.error.set(`Не удалось создать приглашение: ${e instanceof Error ? e.message : e}`);
    }
  }

  async accept(text: string) {
    this.scanning.set(false);
    this.error.set('');
    this.message.set('');
    this.busy.set(true);
    try {
      await this.lan.acceptAnswer(text);
      this.pasted = '';
      this.message.set('✓ Игрок подключён! Следующий может сканировать новый QR №1.');
      this.audio.play('connected');
      await this.newInvite();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Ошибка подключения');
      this.audio.play('disconnected');
      // Приглашение могло испортиться — выдаём новое.
      await this.newInvite();
    } finally {
      this.busy.set(false);
    }
  }
}
