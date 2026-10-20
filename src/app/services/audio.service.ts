import { Injectable, effect, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

const STORAGE_KEYS = {
  VOLUME: 'audio_volume',
  MUTED: 'audio_muted'
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Звуки интерфейса (файлы из проекта p2p). Громкость/mute общие с игровыми эффектами. */
@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private throttledPlay$ = new Subject<string>();

  private isMutedSignal = signal<boolean>(readStorage(STORAGE_KEYS.MUTED) === 'true');
  readonly isMuted = this.isMutedSignal.asReadonly();

  private volumeSignal = signal<number>(Number(readStorage(STORAGE_KEYS.VOLUME) ?? 0.5) || 0.5);
  readonly volume = this.volumeSignal.asReadonly();

  constructor() {
    this.preloadSounds();

    effect(() => {
      const vol = this.volumeSignal();
      const muted = this.isMutedSignal();
      try {
        localStorage.setItem(STORAGE_KEYS.VOLUME, vol.toString());
        localStorage.setItem(STORAGE_KEYS.MUTED, muted.toString());
      } catch {
        /* приватный режим */
      }
      this.sounds.forEach((audio) => (audio.volume = vol));
    });

    this.throttledPlay$.pipe(throttleTime(5000)).subscribe((key) => this.executePlay(key));
  }

  private preloadSounds() {
    const assets = [
      { key: 'click', path: 'assets/sounds/mixkit-typewriter-soft-click-1125.wav' },
      { key: 'send-message', path: 'assets/sounds/mixkit-mouse-click-close-1113.wav' },
      { key: 'connected', path: 'assets/sounds/notification-sound.mp3' },
      { key: 'disconnected', path: 'assets/sounds/error-in-the-computer.mp3' },
      { key: 'notification', path: 'assets/sounds/mixkit-arcade-game-jump-coin-216.wav' }
    ];

    assets.forEach((asset) => {
      const audio = new Audio(asset.path);
      audio.volume = this.volumeSignal();
      audio.preload = 'auto';
      this.sounds.set(asset.key, audio);
    });
  }

  setVolume(value: number): void {
    this.volumeSignal.set(Math.max(0, Math.min(1, value)));
  }

  toggleMute(): void {
    this.isMutedSignal.update((state) => !state);
  }

  play(key: string) {
    this.executePlay(key);
  }

  playNotification(key: string) {
    this.throttledPlay$.next(key);
  }

  private executePlay(key: string) {
    if (this.isMutedSignal()) return;
    const audio = this.sounds.get(key);
    if (audio) {
      audio.currentTime = 0;
      audio.volume = this.volumeSignal();
      audio.play().catch(() => {
        /* автоплей заблокирован до первого касания */
      });
    }
  }
}
