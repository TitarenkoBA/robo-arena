import { TILE } from './constants';
import { T, TileMap } from './tiles';

/*
 * Легенда карт:
 *  #  металл (неразрушаемый)     R  камень (прочный)     B  кирпич
 *  W  дерево                     G  стекло               -  платформа (запрыгнуть снизу)
 *  ^  прыжковая площадка         1..4  парные телепорты
 *  S  точка появления            w  оружие                P  усилитель
 *  H  аптечка +25                M  мега-здоровье         a  броня +50    A  броня +100
 *  o  ящик патронов              c  деревянный ящик       k  железный ящик    x  взрывная бочка
 */

export type ItemKind = 'health' | 'mega' | 'armor' | 'armorBig' | 'ammo' | 'weapon' | 'power';
export type PropKind = 'crate' | 'metal' | 'barrel';

export interface MapDef {
  id: string;
  name: string;
  /** Нижняя граница открыта — можно упасть в пропасть. */
  openBottom: boolean;
  bg: [string, string];
  rows: string[];
}

export interface ParsedMap {
  def: MapDef;
  tiles: TileMap;
  spawns: { x: number; y: number }[];
  items: { kind: ItemKind; x: number; y: number }[];
  props: { kind: PropKind; x: number; y: number }[];
}

const FACTORY: MapDef = {
  id: 'factory',
  name: 'Фабрика',
  openBottom: false,
  bg: ['#141a2e', '#2a1f3d'],
  rows: [
    '                                                                      ',
    '    P                                                          P      ',
    '  ------               w                     w               ------   ',
    '                   ##########          ##########                     ',
    '         H                                                   H        ',
    '                        GGGGGGGGGGGGGGGGGGGGGG                        ',
    '  w    -----            G         A          G           -----    w   ',
    '######                  G   c            c   G                  ######',
    '     #        1         GGGGGGGGG----GGGGGGGGG        1         #     ',
    '  S                                                                S  ',
    '     W                                                          W     ',
    '######   ------         x                    x         ------   ######',
    '                    BBBBBBBBB            BBBBBBBBB                    ',
    '    H                                                          H      ',
    ' ------      w                  P                   w        ------   ',
    '          #######          ############          #######              ',
    '                                                                      ',
    '  S         c  c       S                    S        c  c         S   ',
    '#######   ########   ------    ^        ^   ------  ########   #######',
    '                #               ###WW###              #               ',
    '   ^    a       #                                     #       a    ^  ',
    '#########       #    ######WW              WW######   #       ########',
    '                #                  w                  #               ',
    '   2            WWWW     ^    BBBBBBBBBBBB    ^    WWWW           2   ',
    '#######                                                       ####### ',
    '       ####       c    S    H     o    H    S     c     ####          ',
    '######################################################################',
  ],
};

const SKY: MapDef = {
  id: 'sky',
  name: 'Небесные острова',
  openBottom: true,
  bg: ['#0f2a4a', '#3a6a9a'],
  rows: [
    '                                                                      ',
    '      P                                                       P       ',
    '    -----                    w        w                     -----     ',
    '                         ################                             ',
    '            a                                        a                ',
    '        #########            GGGGGGGGGGGG            #########        ',
    '                    1                                    1            ',
    '  w                       c      M      c                       w     ',
    '#####                  RRRRRRRRRRRRRRRRRRRRR                  #####   ',
    '    #       H                                         H       #       ',
    '    #  S  -----                                     -----  S  #       ',
    '    #######          ^       x           x       ^          #######   ',
    '                  #######  WWWWWWW   WWWWWWW  #######                 ',
    '                                                                      ',
    '        o                     P                             o         ',
    '     -------      w       ##########       w        -------           ',
    '                -----                    -----                        ',
    '   S                  BBBB    S    BBBB                  S            ',
    '######  ^          ######################          ^  ######          ',
    '     #####                    k  k                   #####            ',
    '                  2        ##########         2                       ',
    '      H     c   -----                       -----   c     H           ',
    '   #########  ^                                    ^  #########       ',
    '                       S          S                                   ',
    '               ########################################               ',
    '                                                                      ',
    '                                                                      ',
  ],
};

const FORTRESS: MapDef = {
  id: 'fortress',
  name: 'Две крепости',
  openBottom: false,
  bg: ['#1f1a14', '#4a3a2a'],
  rows: [
    '                                                                      ',
    '                                 P                                    ',
    '                       -----------------------                        ',
    '     w                                                        w       ',
    '  BBBBBBBB                    G    M    G                  BBBBBBBB   ',
    '  B      B        a           GGGGGGGGGGG          a       B      B   ',
    '  B  S   B      -----                            -----     B   S  B   ',
    '  B       W                        x                      W       B   ',
    '  BBB--BBBB              ^     ########    ^             BBBB--BBB    ',
    '  B       B     c       ####              ####      c    B       B    ',
    '  B   H   B   -----                                -----  B   H   B   ',
    '  B       W           w           1  1          w         W       B   ',
    '  BB---BBBB     x   WWWWWW     RRRRRRRRRR     WWWWWW   x  BBBB---BB   ',
    '                                                                      ',
    '      a           k           c   o    c            k           a     ',
    '   ------     #########   ##########GG##########   #########  ------  ',
    '  S                                                                S  ',
    '########     ^         w                    w         ^     ########  ',
    '       B   #####     BBBBB     2       2     BBBBB     #####   B      ',
    '  H    W                         S    S                        W   H  ',
    '########  c  x     ------    WWWWWWWWWWWWWW    ------   x  c  ########',
    '                                                                      ',
    '    S    ^       c        S        P        S        c      ^    S    ',
    '######################################################################',
  ],
};

const ARENA: MapDef = {
  id: 'arena',
  name: 'Мини-арена',
  openBottom: false,
  bg: ['#1a1030', '#40205a'],
  rows: [
    '                                                  ',
    '        w           P              w              ',
    '      -----      ########       -----             ',
    '                                                  ',
    '  H         GGGGG        GGGGG          H         ',
    ' ----   1                          1  ----        ',
    '              c      M       c                    ',
    '       BBBBBBBBBBB  ----  BBBBBBBBBBB             ',
    '  S                                       S       ',
    '#####   ^      w      x       w     ^   #####     ',
    '      ######       WWWWWW       ######            ',
    '  a                                        a      ',
    '   S       k     S        S      k       S        ',
    '##################################################',
  ],
};

export const MAPS: MapDef[] = [FACTORY, SKY, FORTRESS, ARENA];

export function parseMap(def: MapDef): ParsedMap {
  const inner = def.rows;
  const innerW = Math.max(...inner.map((r) => r.length));
  const w = innerW + 2;
  const h = inner.length + 1;
  const tiles = new TileMap(w, h);
  const spawns: ParsedMap['spawns'] = [];
  const items: ParsedMap['items'] = [];
  const props: ParsedMap['props'] = [];
  const tele: Record<string, number[]> = {};

  for (let x = 0; x < w; x++) tiles.t[x] = T.METAL; // потолок
  for (let r = 0; r < inner.length; r++) {
    const cy = r + 1;
    const row = inner[r].padEnd(innerW, ' ');
    tiles.t[cy * w] = T.METAL;
    tiles.t[cy * w + w - 1] = T.METAL;
    for (let c = 0; c < innerW; c++) {
      const cx = c + 1;
      const i = cy * w + cx;
      const ch = row[c];
      const px = cx * TILE + TILE / 2;
      const py = cy * TILE + TILE / 2;
      let tt = T.EMPTY;
      switch (ch) {
        case '#': tt = T.METAL; break;
        case 'R': tt = T.STONE; break;
        case 'B': tt = T.BRICK; break;
        case 'W': tt = T.WOOD; break;
        case 'G': tt = T.GLASS; break;
        case '-': tt = T.PLATFORM; break;
        case '^': tt = T.JUMPPAD; break;
        case '1': case '2': case '3': case '4':
          tt = T.TELE;
          (tele[ch] ??= []).push(i);
          break;
        case 'S': spawns.push({ x: px, y: py }); break;
        case 'H': items.push({ kind: 'health', x: px, y: py }); break;
        case 'M': items.push({ kind: 'mega', x: px, y: py }); break;
        case 'a': items.push({ kind: 'armor', x: px, y: py }); break;
        case 'A': items.push({ kind: 'armorBig', x: px, y: py }); break;
        case 'o': items.push({ kind: 'ammo', x: px, y: py }); break;
        case 'w': items.push({ kind: 'weapon', x: px, y: py }); break;
        case 'P': items.push({ kind: 'power', x: px, y: py }); break;
        case 'c': props.push({ kind: 'crate', x: px, y: py }); break;
        case 'k': props.push({ kind: 'metal', x: px, y: py }); break;
        case 'x': props.push({ kind: 'barrel', x: px, y: py }); break;
      }
      tiles.t[i] = tt;
    }
  }
  for (const pair of Object.values(tele)) {
    if (pair.length >= 2) {
      tiles.tele.set(pair[0], pair[1]);
      tiles.tele.set(pair[1], pair[0]);
    }
  }
  // Пересчитать HP после ручного заполнения.
  const fresh = new TileMap(w, h, tiles.t);
  tiles.tele.forEach((v, k) => fresh.tele.set(k, v));
  return { def, tiles: fresh, spawns, items, props };
}

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
