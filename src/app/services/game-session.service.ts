import { Injectable, signal } from '@angular/core';
import { COLORS } from '../game/constants';
import { Role } from '../game/engine';
import { DEFAULT_SETTINGS, GameSettings } from '../game/types';

const KEY = 'robo2d_profile';

interface Profile {
  name: string;
  color: string;
  settings: GameSettings;
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      return {
        name: p.name || randomName(),
        color: p.color || COLORS[0],
        settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
      };
    }
  } catch {
    /* повреждённые данные — используем по умолчанию */
  }
  return { name: randomName(), color: COLORS[Math.floor(Math.random() * COLORS.length)], settings: { ...DEFAULT_SETTINGS } };
}

function randomName() {
  return 'Игрок-' + Math.floor(100 + Math.random() * 900);
}

/** Профиль игрока и параметры запуска игры, общие для экранов меню и игры. */
@Injectable({ providedIn: 'root' })
export class GameSessionService {
  private profile = load();
  readonly name = signal(this.profile.name);
  readonly color = signal(this.profile.color);
  readonly settings = signal<GameSettings>(this.profile.settings);
  /** Как запускать следующую игру. */
  readonly role = signal<Role>('offline');
  readonly roomCode = signal<string | null>(null);
  /** Через что идёт сетевая игра: PeerJS-сервер или офлайн-обмен QR-кодами. */
  readonly net = signal<'online' | 'lan'>('online');

  save() {
    this.profile = { name: this.name().trim().slice(0, 16) || randomName(), color: this.color(), settings: this.settings() };
    this.name.set(this.profile.name);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.profile));
    } catch {
      /* приватный режим */
    }
  }

  inviteUrl(code: string) {
    const base = location.href.split('#')[0];
    return `${base}#/join/${code}`;
  }
}
