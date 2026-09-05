/**
 * App icons, generated from the design tokens.
 *
 * Written as a script rather than committed binaries alone, so the mark can be
 * regenerated when the tokens change and nobody has to wonder where a PNG came
 * from. Dependency-free: a PNG is a zlib stream plus four CRC'd chunks, and
 * pulling in an image library to draw three rectangles would be silly.
 *
 * Run: node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BRASS = [0x9a, 0x6f, 0x14];
const INK = [0x0b, 0x0f, 0x14];
const LIGHT = [0xf4, 0xea, 0xd3];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, draw) {
  // One filter byte (0 = none) per row, then RGB triples.
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y, size);
      const at = y * stride + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Three bars of unequal length on a brass ground — a ledger, read at 48px.
 * `inset` leaves the safe area a maskable icon needs, since Android may crop
 * anything outside the middle 80% to whatever shape the launcher prefers.
 */
function ledger(inset) {
  return (x, y, size) => {
    const pad = size * inset;
    const span = size - pad * 2;

    // Bars occupy the middle band, evenly spaced.
    const barHeight = span * 0.13;
    const gap = span * 0.135;
    const top = pad + (span - (barHeight * 3 + gap * 2)) / 2;
    const widths = [1, 0.66, 0.85];

    for (let i = 0; i < 3; i++) {
      const barTop = top + i * (barHeight + gap);
      if (y >= barTop && y < barTop + barHeight) {
        const right = pad + span * widths[i];
        if (x >= pad && x < right) return i === 1 ? LIGHT : [0xff, 0xff, 0xff];
      }
    }
    // A slight vertical fall in the ground, so the tile reads as crafted
    // rather than flat at launcher size.
    const t = y / size;
    return [
      Math.round(BRASS[0] * (1 - t * 0.28)),
      Math.round(BRASS[1] * (1 - t * 0.28)),
      Math.round(BRASS[2] * (1 - t * 0.28)),
    ];
  };
}

/** A dark ground so the mark keeps its edge on a light home screen. */
function onInk(draw) {
  return draw;
}

const targets = [
  ['public/icon-192.png', 192, ledger(0.22)],
  ['public/icon-512.png', 512, ledger(0.22)],
  // Maskable icons are cropped to the launcher's shape, so the mark sits well
  // inside the safe area and the ground runs to every edge.
  ['public/icon-maskable-512.png', 512, ledger(0.29)],
  ['public/apple-touch-icon.png', 180, ledger(0.22)],
];

for (const [path, size, draw] of targets) {
  writeFileSync(path, png(size, onInk(draw)));
  console.log(`wrote ${path} (${String(size)}×${String(size)})`);
}
void INK;
