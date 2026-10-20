import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QrScannerComponent } from '../components/qr-scanner.component';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { PeerJsService } from '../services/peerjs.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

/** Достаёт код комнаты из ссылки-приглашения или из «голого» кода. */
export function parseRoomCode(text: string): string {
  const t = text.trim();
  const m = /#\/join\/([a-z0-9-]+)/i.exec(t);
  if (m) return m[1].toLowerCase();
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

@Component({
  selector: 'app-join',
  imports: [FormsModule, QrScannerComponent],
  template: `
    <main class="page">
      <div class="flex items-center gap-3">
        <button type="button" class="btn small" (click)="back()">← Назад</button>
        <h2 class="text-xl font-extrabold">Подключение</h2>
      </div>

      @if (busy()) {
        <section class="card mt-6 text-center">
          <div class="spinner mx-auto"></div>
          <p class="mt-3">{{ peer.status() }}</p>
          <p class="mt-1 font-mono text-emerald-300">{{ code }}</p>
        </section>
      } @else {
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <section class="card">
            <h3 class="mb-3 text-center font-bold">Сканировать QR-код</h3>
            <app-qr-scanner (scanned)="onScan($event)" />
          </section>
          <section class="card">
            <h3 class="mb-3 font-bold">Или ввести код комнаты</h3>
            <form (ngSubmit)="join()" class="flex gap-2">
              <input class="field font-mono uppercase tracking-widest" [(ngModel)]="code" name="code" placeholder="abc123" maxlength="40" autocapitalize="off" autocomplete="off" />
              <button class="btn btn-primary" type="submit" [disabled]="!code.trim()">Войти</button>
            </form>
            @if (error()) {
              <p class="mt-3 text-sm text-orange-300">{{ error() }}</p>
            }
            <p class="mt-4 text-sm text-white/60">Код показан у создателя комнаты под QR-кодом. Можно также просто открыть присланную ссылку.</p>
          </section>
        </div>
      }
    </main>
  `,
})
export class JoinComponent implements OnInit {
  protected readonly peer = inject(PeerJsService);
  private readonly session = inject(GameSessionService);
  private readonly audio = inject(AudioService);
  private readonly sfx = inject(SfxService);
  private readonly pwa = inject(PwaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected code = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnInit() {
    const c = this.route.snapshot.paramMap.get('code');
    if (c) {
      this.code = parseRoomCode(c);
      void this.join();
    }
  }

  onScan(text: string) {
    this.code = parseRoomCode(text);
    void this.join();
  }

  async join() {
    const code = parseRoomCode(this.code);
    if (!code) return;
    this.sfx.unlock();
    this.error.set('');
    this.busy.set(true);
    try {
      await this.peer.joinRoom(code);
      this.audio.play('connected');
      this.session.roomCode.set(code);
      this.session.role.set('client');
      void this.pwa.enterGameMode();
      void this.router.navigate(['/play']);
    } catch (e) {
      this.busy.set(false);
      this.error.set(e instanceof Error ? e.message : 'Не удалось подключиться');
      this.audio.play('disconnected');
    }
  }

  back() {
    this.audio.play('click');
    this.peer.disconnect(false);
    void this.router.navigate(['/']);
  }
}
