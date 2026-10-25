#!/usr/bin/env node
/**
 * 生成飞牛应用图标（零依赖，直接手写 PNG）。
 *
 * 飞牛官方图标规范：正方形，圆角半径 = 边长 × 18.75%（256 → 48px）。
 * 产物：
 *   fnos/siteguard/ICON.PNG            64×64
 *   fnos/siteguard/ICON_256.PNG        256×256
 *   fnos/siteguard/app/ui/images/icon_64.png / icon_128.png / icon_256.png
 *
 * 用法：node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ---------------- PNG 编码 ---------------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 图形 ---------------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

// 品牌渐变：左上青蓝 → 右下靛蓝，与面板配色一致。
const FROM = [14, 165, 233];
const TO = [67, 56, 202];

const RADIUS = 0.1875; // 官方圆角比例
const half = 0.5 - RADIUS;

/** 圆角方形（SDF），返回是否在内部。 */
function insideRoundedSquare(x, y) {
  const qx = Math.abs(x - 0.5) - half;
  const qy = Math.abs(y - 0.5) - half;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - RADIUS <= 0;
}

/** 盾牌轮廓：上方两肩 + 下方收成尖。 */
const SHIELD = (() => {
  const points = [
    [0.255, 0.185],
    [0.5, 0.255],
    [0.745, 0.185],
    [0.745, 0.4]
  ];
  const curve = (from, control, to, steps) => {
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0];
      const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1];
      points.push([x, y]);
    }
  };
  curve([0.745, 0.4], [0.725, 0.7], [0.5, 0.845], 14);
  curve([0.5, 0.845], [0.275, 0.7], [0.255, 0.4], 14);
  return points;
})();

function insidePolygon(x, y, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const CHECK = [
  [0.372, 0.492],
  [0.462, 0.588],
  [0.638, 0.392]
];

function distanceToPolyline(x, y, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = clamp01(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

function render(size) {
  const samples = 4; // 4×4 超采样做抗锯齿
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let coverage = 0;
      let shield = 0;
      let check = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (!insideRoundedSquare(x, y)) continue;
          coverage += 1;
          if (!insidePolygon(x, y, SHIELD)) continue;
          shield += 1;
          if (distanceToPolyline(x, y, CHECK) <= 0.043) check += 1;
        }
      }

      const total = samples * samples;
      const alpha = coverage / total;
      const offset = (py * size + px) * 4;
      if (alpha === 0) {
        out.writeUInt32BE(0, offset);
        continue;
      }

      const t = clamp01(((px + py) / (2 * size) - 0.05) / 0.9);
      let r = lerp(FROM[0], TO[0], t);
      let g = lerp(FROM[1], TO[1], t);
      let b = lerp(FROM[2], TO[2], t);

      const shieldRatio = shield / total;
      const checkRatio = check / total;
      // 盾牌铺白，再在盾牌内用品牌色描出对勾。
      r = lerp(r, 255, shieldRatio);
      g = lerp(g, 255, shieldRatio);
      b = lerp(b, 255, shieldRatio);
      r = lerp(r, 15, checkRatio);
      g = lerp(g, 46, checkRatio);
      b = lerp(b, 84, checkRatio);

      out[offset] = Math.round(r);
      out[offset + 1] = Math.round(g);
      out[offset + 2] = Math.round(b);
      out[offset + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, out);
}

const targets = [
  ['fnos/siteguard/ICON.PNG', 64],
  ['fnos/siteguard/ICON_256.PNG', 256],
  ['fnos/siteguard/app/ui/images/icon_64.png', 64],
  ['fnos/siteguard/app/ui/images/icon_128.png', 128],
  ['fnos/siteguard/app/ui/images/icon_256.png', 256]
];

for (const [relative, size] of targets) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, render(size));
  console.log(`icon ${relative} ${size}×${size}`);
}
