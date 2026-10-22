import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { QrCodeComponent } from '../components/qr-code.component';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { LanService } from '../services/lan.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

/** Гость в офлайн-режиме: принял приглашение и показывает хосту QR-ответ. */
@Component({
  selector: 'app-lan-join',
  imports: [QrCodeComponent],
  template: `
    <main class="page">
      <div class="flex items-center gap-3">
        <button type="button" class="btn small" (click)="back()">← Назад</button>
        <h2 class="text-xl font-extrabold">Игра без интернета</h2>
      </div>

      <section class="card mx-auto mt-4 max-w-md text-center">
        @if (error()) {
          <p class="text-orange-300">{{ error() }}</p>
          <p class="mt-2 text-sm text-white/60">Попросите хоста показать новый QR-код приглашения и отсканируйте его ещё раз.</p>
          <button type="button" class="btn btn-accent mt-4" (click)="rescan()">📷 Сканировать заново</button>
        } @else if (answer(); as a) {
          <p class="text-xs font-bold uppercase tracking-wide text-emerald-300">QR №2 · ответ</p>
          <p class="mt-1 font-bold">Покажите этот код хосту</p>
          <p class="text-sm text-white/60">Хост нажимает «Сканировать ответ игрока» и наводит камеру на ваш экран.</p>
          <div class="mt-3 flex justify-center" [attr.data-answer]="a">
            <app-qr-code [text]="a" [size]="qrSize" ecl="L" />
          </div>
          <div class="mt-3 flex items-center justify-center gap-2 text-sm text-white/70">
            <div class="spinner !h-5 !w-5 !border-2"></div> Ждём, когда хост отсканирует…
          </div>
          <button type="button" class="btn small mt-3" (click)="copy(a)">{{ copied() ? '✓ Скопировано' : '📋 Копировать код (если у хоста нет камеры)' }}</button>
        } @else {
          <div class="spinner mx-auto my-6"></div>
          <p class="text-white/70">Готовим ответ…</p>
        }
      </section>
    </main>
  `,
})
export class LanJoinComponent implements OnInit, OnDestroy {
  private readonly lan = inject(LanService);
  private readonly session = inject(GameSessionService);
  private readonly audio = inject(AudioService);
  private readonly sfx = inject(SfxService);
  private readonly pwa = inject(PwaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly answer = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly copied = signal(false);
  protected readonly qrSize = Math.min(320, Math.round(Math.min(window.innerWidth - 64, window.innerHeight * 0.55)));
  private left = false;

  async ngOnInit() {
    const payload = this.route.snapshot.paramMap.get('payload') ?? '';
    try {
      this.answer.set(await this.lan.acceptInvite(payload));
      await this.lan.waitConnected();
      if (this.left) return;
      this.audio.play('connected');
      this.session.role.set('client');
      this.session.net.set('lan');
      void this.pwa.enterGameMode();
      void this.router.navigate(['/play']);
    } catch (e) {
      if (this.left) return;
      this.error.set(e instanceof Error ? e.message : 'Не удалось подключиться');
      this.audio.play('disconnected');
    }
  }

  ngOnDestroy() {
    this.left = true;
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* нет доступа к буферу */
    }
  }

  rescan() {
    this.sfx.unlock();
    this.lan.disconnect(false);
    void this.router.navigate(['/join']);
  }

  back() {
    this.audio.play('click');
    this.lan.disconnect(false);
    void this.router.navigate(['/']);
  }
}
