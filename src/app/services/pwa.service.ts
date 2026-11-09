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

  /**
   * Вход в игру на телефоне: во весь экран и поворот в альбомную ориентацию.
   * Меню при этом остаётся вертикальным: установленное приложение по манифесту
   * портретное, а после выхода из игры блокировка снимается (exitGameMode).
   * Работает там, где браузер позволяет (Android Chrome); на iOS — подсказка повернуть телефон.
   * Нужно вызывать из обработчика нажатия (требование браузеров к полноэкранному режиму).
   */
  async enterGameMode(): Promise<boolean> {
    if (!this.isTouch) return false;
    try {
      if (!document.fullscreenElement && !this.isStandalone && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      /* iOS Safari не поддерживает fullscreen для страниц */
    }
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape');
      return true;
    } catch {
      return false;
    }
  }

  /** Выход из игры: вернуть ориентацию меню (портрет) и выйти из полноэкранного режима. */
  async exitGameMode() {
    if (!this.isTouch) return;
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* не везде доступно */
    }
    try {
      // В установленном приложении после unlock() действует ориентация из манифеста (портрет).
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* не поддерживается */
    }
  }

  /** Сейчас экран вертикальный. */
  isPortrait() {
    return matchMedia('(orientation: portrait)').matches;
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
