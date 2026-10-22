import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LanInviteComponent } from '../components/lan-invite.component';
import { QrCodeComponent } from '../components/qr-code.component';
import { LanService } from '../services/lan.service';
import { MAPS } from '../game/maps';
import { GameSettings } from '../game/types';
import { AudioService } from '../services/audio.service';
import { GameSessionService } from '../services/game-session.service';
import { PeerJsService } from '../services/peerjs.service';
import { PwaService } from '../services/pwa.service';
import { SfxService } from '../services/sfx.service';

@Component({
  selector: 'app-host',
  imports: [FormsModule, QrCodeComponent, LanInviteComponent],
  template: `
    <main class="page">
      <div class="flex items-center gap-3">
        <button type="button" class="btn small" (click)="back()">← Назад</button>
        <h2 class="text-xl font-extrabold">{{ online ? 'Новая комната' : lan ? 'Игра без интернета' : 'Игра с ботами' }}</h2>
      </div>

      <div [class]="online || lan ? 'mt-4 grid gap-4 md:grid-cols-2' : 'mx-auto mt-4 grid w-full max-w-xl gap-4'">
        @if (lan) {
          <section class="card">
            <app-lan-invite />
            <p class="mt-3 text-center text-xs text-white/50">Все устройства — в одной сети Wi-Fi или на точке доступа вашего телефона. Игроков можно добавлять и во время матча (меню ☰).</p>
          </section>
        }
        @if (online) {
          <section class="card flex flex-col items-center text-center">
            @if (code(); as c) {
              <p class="text-sm text-white/70">Отсканируйте камерой телефона или в игре</p>
              <div class="mt-3"><app-qr-code [text]="invite()" [size]="qrSize" /></div>
              <p class="mt-3 text-sm text-white/60">Код комнаты</p>
              <p class="font-mono text-3xl font-black tracking-[0.25em] text-emerald-300">{{ c }}</p>
              <div class="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" class="btn small" (click)="copy()">{{ copied() ? '✓ Скопировано' : '📋 Ссылка' }}</button>
                @if (canShare) {
                  <button type="button" class="btn small" (click)="share()">📤 Поделиться</button>
                }
              </div>
              <p class="mt-3 text-sm">Подключено игроков: <b>{{ peer.peerCount() }}</b></p>
              <p class="mt-1 text-xs text-white/50">Друзья могут заходить и во время матча.</p>
            } @else {
              <p class="py-10 text-white/70">{{ error() || peer.status() }}</p>
              @if (error()) {
                <button type="button" class="btn small" (click)="createRoom()">Повторить</button>
              }
            }
          </section>
        }

        <section class="card">
          <h3 class="mb-3 font-bold">Настройки матча</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="col-span-2">
              <span class="label">Карта</span>
              <select class="field" [ngModel]="s().mapId" (ngModelChange)="set('mapId', $event)">
                @for (m of maps; track m.id) {
                  <option [value]="m.id">{{ m.name }}{{ m.openBottom ? ' (с пропастями)' : '' }}</option>
                }
              </select>
            </label>
            <label>
              <span class="label">Режим</span>
              <select class="field" [ngModel]="s().mode" (ngModelChange)="set('mode', $event)">
                <option value="ffa">Каждый сам за себя</option>
                <option value="tdm">Команды</option>
              </select>
            </label>
            <label>
              <span class="label">Лимит выбиваний</span>
              <select class="field" [ngModel]="s().fragLimit" (ngModelChange)="set('fragLimit', +$event)">
                @for (v of [5, 10, 15, 20, 30, 50]; track v) { <option [value]="v">{{ v }}</option> }
              </select>
            </label>
            <label>
              <span class="label">Время, мин</span>
              <select class="field" [ngModel]="s().timeLimit" (ngModelChange)="set('timeLimit', +$event)">
                @for (v of [3, 5, 10, 15, 20]; track v) { <option [value]="v">{{ v }}</option> }
              </select>
            </label>
            <label>
              <span class="label">Ботов: {{ s().bots }}</span>
              <input type="range" class="w-full" min="0" max="10" [ngModel]="s().bots" (ngModelChange)="set('bots', +$event)" />
            </label>
            <label class="col-span-2">
              <span class="label">Сложность ботов: {{ skillNames[s().botSkill - 1] }}</span>
              <input type="range" class="w-full" min="1" max="5" [ngModel]="s().botSkill" (ngModelChange)="set('botSkill', +$event)" />
            </label>
            @if (s().mode === 'tdm') {
              <label class="col-span-2 flex items-center gap-2">
                <input type="checkbox" [ngModel]="s().friendlyFire" (ngModelChange)="set('friendlyFire', $event)" />
                Урон по своим
              </label>
            }
          </div>
          <button type="button" class="btn btn-primary big mt-4 w-full" [disabled]="online && !code()" (click)="play()">⚔️ В бой!</button>
        </section>
      </div>
    </main>
  `,
})
export class HostComponent implements OnInit {
  protected readonly session = inject(GameSessionService);
  protected readonly peer = inject(PeerJsService);
  private readonly audio = inject(AudioService);
  private readonly sfx = inject(SfxService);
  private readonly pwa = inject(PwaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly maps = MAPS;
  protected readonly skillNames = ['Новичок', 'Лёгкий', 'Средний', 'Сильный', 'Чемпион'];
  protected readonly s = this.session.settings;
  private readonly mode = this.route.snapshot.queryParamMap.get('mode') ?? 'online';
  /** Через сигнальный сервер PeerJS (нужен интернет на старте). */
  protected readonly online = this.mode === 'online';
  /** Без интернета: обмен QR-кодами, игра по локальной сети. */
  protected readonly lan = this.mode === 'lan';
  private readonly lanService = inject(LanService);
  protected readonly code = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly copied = signal(false);
  protected readonly invite = computed(() => this.session.inviteUrl(this.code() ?? ''));
  protected readonly canShare = typeof navigator.share === 'function';
  protected readonly qrSize = Math.min(220, Math.round(window.innerHeight * 0.4));

  ngOnInit() {
    if (!this.online) return;
    // Комната уже создана (вернулись из игры) — используем её.
    if (this.peer.role() === 'host' && this.peer.myPeerId()) this.code.set(this.peer.myPeerId());
    else void this.createRoom();
  }

  async createRoom() {
    this.error.set('');
    try {
      const code = await this.peer.createRoom();
      this.code.set(code);
      this.session.roomCode.set(code);
      this.audio.play('connected');
    } catch (e) {
      this.error.set(`Не удалось создать комнату: ${e instanceof Error ? e.message : 'ошибка'}`);
      this.audio.play('disconnected');
    }
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    this.session.settings.update((s) => ({ ...s, [key]: value }));
    this.session.save();
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.invite());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* нет доступа к буферу */
    }
  }

  async share() {
    try {
      await navigator.share({ title: 'Робо-Арена 2D', text: 'Заходи ко мне на арену!', url: this.invite() });
    } catch {
      /* отменено */
    }
  }

  back() {
    this.audio.play('click');
    if (this.online) this.peer.disconnect();
    if (this.lan) this.lanService.disconnect(false);
    void this.router.navigate(['/']);
  }

  play() {
    this.sfx.unlock();
    this.audio.play('click');
    this.session.save();
    this.session.role.set(this.online || this.lan ? 'host' : 'offline');
    this.session.net.set(this.lan ? 'lan' : 'online');
    void this.pwa.enterGameMode();
    void this.router.navigate(['/play']);
  }
}
