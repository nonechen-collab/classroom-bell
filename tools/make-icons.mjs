// 產生 PWA 圖示（綠色時鐘）：node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

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
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2;
  const r = size * 0.42;
  const hand = size * 0.035;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // 每列的濾波方式：無
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      const d = Math.hypot(px, py);
      // 背景：深藍；圓：綠；指針：白（12 點與 3 點方向）
      let rgb = [11, 26, 38];
      if (d <= r) rgb = [46, 157, 91];
      const isHand =
        (Math.abs(px) <= hand && py <= 0 && py >= -r * 0.62) || (Math.abs(py) <= hand && px >= 0 && px <= r * 0.48);
      if (d <= r && isHand) rgb = [255, 255, 255];
      if (d <= hand * 1.8) rgb = [255, 255, 255];
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位元深度
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../web/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) writeFileSync(new URL(`../web/icons/icon-${size}.png`, import.meta.url), png(size));
console.log('icons written');
