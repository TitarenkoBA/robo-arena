import { DT } from './constants';
import { ClientState, HostMsg, decodeInput, encodeInput, encodeMe, encodeSnapshot } from './net';
import { DEFAULT_SETTINGS, Input } from './types';
import { World } from './world';

const roundTrip = <T>(m: T): T => JSON.parse(JSON.stringify(m)) as T;

describe('Сетевой протокол', () => {
  it('ввод кодируется без потерь', () => {
    const i: Input = { seq: 42, mx: -1, jump: true, down: false, fire: true, aim: 1.234, w: 5 };
    expect(decodeInput(roundTrip(encodeInput(i)))).toEqual(i);
  });

  it('предсказание клиента сходится с хостом', () => {
    const world = new World({ ...DEFAULT_SETTINGS, mapId: 'arena', bots: 0 });
    world.addPlayer('Бот', '#fff', true);
    const remote = world.addPlayer('Гость', '#0ff', false);
    const crack: number[] = [];
    const welcome = roundTrip<Extract<HostMsg, { t: 'welcome' }>>({
      t: 'welcome', you: remote.id, settings: world.settings, tiles: world.map.encode(), crack, gen: world.generation,
    });
    const client = new ClientState(welcome);
    client.setRoster(world.roster());

    let seq = 0;
    let maxErr = 0;
    const history: Input[] = [];
    for (let tick = 1; tick <= 60 * 10; tick++) {
      // Клиент бегает туда-сюда и прыгает
      const inp: Input = {
        seq: ++seq, mx: Math.sin(tick / 40) > 0 ? 1 : -1, jump: tick % 50 < 10, down: false, fire: false, aim: 0, w: 0,
      };
      client.predict(inp, () => {});
      history.push(inp);
      // Сеть: хост получает ввод с задержкой в 3 тика
      if (tick > 3) remote.inputQueue.push(decodeInput(roundTrip(encodeInput(history[tick - 4]))));
      world.step(DT);
      world.events = [];
      if (tick % 2 === 0) {
        const snap = roundTrip({ ...encodeSnapshot(world, tick), me: encodeMe(remote) });
        client.applySnapshot(snap, tick * 16);
      }
      if (client.me?.alive && remote.alive && tick > 120) {
        maxErr = Math.max(maxErr, Math.hypot(client.me.x - remote.x, client.me.y - remote.y));
      }
    }
    expect(client.players.size).toBe(2);
    expect(client.me).not.toBeNull();
    // Клиент опережает хост на 3 тика ввода — расхождение не больше пары шагов бега.
    expect(maxErr).toBeLessThan(60);
  });
});
