#!/usr/bin/env node
/**
 * Генерирует PNG-иконки PWA (192, 512, maskable 512) без внешних зависимостей.
 * Рисует того же робота, что и public/icons/icon.svg.
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

/** Цвет в точке (координаты в системе 512×512). Возвращает [r,g,b,a]. */
function sample(x, y, maskable) {
  // Для maskable — фон на весь квадрат, робот уменьшен в «безопасную зону».
  let bgA = 1;
  if (!maskable && !inRoundRect(x, y, 0, 0, 512, 512, 112)) bgA = 0;
  const t = (x + y) / 1024;
  const c0 = hex('#2a2150');
  const c1 = hex('#0e1324');
  let col = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
  if (maskable) {
    const s = 0.72;
    x = (x - 256) / s + 256;
    y = (y - 256) / s + 256;
  }
  const layer = (c, a = 1) => {
    const v = hex(c);
    col = col.map((ch, i) => ch * (1 - a) + v[i] * a);
  };
  if (distToSeg(x, y, 214, 138, 196, 92) < 7) layer('#adb5bd');
  if ((x - 194) ** 2 + (y - 86) ** 2 < 400) layer('#ffd43b');
  if (inRoundRect(x, y, 136, 136, 240, 170, 56)) layer('#20c997');
  if (inRoundRect(x, y, 226, 180, 124, 72, 26)) layer('#1e2433');
  if (inRoundRect(x, y, 300, 198, 30, 30, 6)) layer('#e7f5ff');
  if (inRoundRect(x, y, 150, 310, 212, 122, 48)) layer('#20c997');
  if (inRoundRect(x, y, 200, 340, 112, 62, 20)) layer('#ffffff', 0.3);
  if (inRoundRect(x, y, 300, 352, 150, 34, 12)) layer('#343a40');
  if (x >= 318 && x <= 422 && y >= 360 && y <= 370) layer('#ff5d5d');
  return [...col, bgA * 255];
}

function render(size, maskable) {
  const ss = 3;
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    data[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 512;
          const y = ((py + (sy + 0.5) / ss) / size) * 512;
          const c = sample(x, y, maskable);
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const a = acc[3] / (ss * ss);
      data[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      data[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      data[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      data[o + 3] = Math.round(a);
    }
  }
  return png(size, size, data);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon-192.png'), render(192, false));
writeFileSync(join(OUT, 'icon-512.png'), render(512, false));
writeFileSync(join(OUT, 'icon-maskable-512.png'), render(512, true));
console.log('Иконки созданы в', OUT);
