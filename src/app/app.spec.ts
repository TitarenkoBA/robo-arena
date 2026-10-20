import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { parseRoomCode } from './pages/join.component';
import { mapById, MAPS, parseMap } from './game/maps';
import { PLAYABLE_WEAPONS } from './game/weapons';
import { World } from './game/world';
import { DEFAULT_SETTINGS } from './game/types';
import { DT } from './game/constants';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

describe('Игра', () => {
  it('имеет минимум 20 видов оружия', () => {
    expect(PLAYABLE_WEAPONS.length).toBeGreaterThanOrEqual(20);
  });

  it('разбирает все карты: есть точки появления и телепорты парные', () => {
    for (const def of MAPS) {
      const m = parseMap(def);
      expect(m.spawns.length).toBeGreaterThan(3);
      for (const [a, b] of m.tiles.tele) expect(m.tiles.tele.get(b)).toBe(a);
    }
  });

  it('извлекает код комнаты из ссылки', () => {
    expect(parseRoomCode('https://x.github.io/p2p-game/#/join/abc123')).toBe('abc123');
    expect(parseRoomCode(' ABC123 ')).toBe('abc123');
  });

  it('симулирует матч с ботами без ошибок', () => {
    for (const def of MAPS) {
      const w = new World({ ...DEFAULT_SETTINGS, mapId: def.id, bots: 0 });
      for (let i = 0; i < 6; i++) w.addPlayer('Бот' + i, '#fff', true);
      for (let t = 0; t < 60 * 20; t++) w.step(DT);
      expect(mapById(def.id).id).toBe(def.id);
      for (const p of w.players.values()) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});
