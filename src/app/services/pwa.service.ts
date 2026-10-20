import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** Установка PWA (логика из проекта p2p) + полноэкранный режим для телефонов. */
@Injectable({ providedIn: 'root' })
export class PwaService {
  readonly canInstall = signal(false);
  readonly isStandalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  readonly isTouch = matchMedia('(pointer: coarse)').matches;
  private promptEvent?: BeforeInstallPromptEvent;

  constructor() {
    if (!this.isStandalone) {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.promptEvent = e as BeforeInstallPromptEvent;
        this.canInstall.set(true);
      });
    }
    window.addEventListener('appinstalled', () => {
      this.promptEvent = undefined;
      this.canInstall.set(false);
    });
  }

  async install() {
    if (!this.promptEvent) return;
    await this.promptEvent.prompt();
    await this.promptEvent.userChoice;
    this.promptEvent = undefined;
    this.canInstall.set(false);
  }

  /** На телефоне — во весь экран и в альбомную ориентацию (где браузер позволяет). */
  async enterGameMode() {
    if (!this.isTouch) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      /* iOS Safari не поддерживает fullscreen для страниц */
    }
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape');
    } catch {
      /* не везде доступно */
    }
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* не поддерживается */
    }
  }
}
