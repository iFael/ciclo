import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BEIGE = [0xe7, 0xdc, 0xc8];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function paint(x, y, size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const radius = size * 0.26;
  const stroke = Math.max(2, size * 0.055);
  const angle = Math.atan2(dy, dx);
  const gap = angle > -0.55 && angle < 0.35;
  const onRing = !gap && Math.abs(dist - radius) <= stroke / 2;
  const tipA = 0.35;
  const tipX = Math.cos(tipA) * radius;
  const tipY = Math.sin(tipA) * radius;
  const barb = stroke * 1.7;
  const a1 = tipA + Math.PI * 0.72;
  const a2 = tipA - Math.PI * 0.72;
  const d1 = distToSeg(dx, dy, tipX, tipY, tipX + Math.cos(a1) * barb, tipY + Math.sin(a1) * barb);
  const d2 = distToSeg(dx, dy, tipX, tipY, tipX + Math.cos(a2) * barb, tipY + Math.sin(a2) * barb);
  return onRing || d1 <= stroke / 2 || d2 <= stroke / 2;
}

function sample(x, y, size) {
  let hits = 0;
  const steps = 4;
  for (let sy = 0; sy < steps; sy += 1) {
    for (let sx = 0; sx < steps; sx += 1) {
      if (paint(x + sx / steps, y + sy / steps, size)) hits += 1;
    }
  }
  const mix = hits / (steps * steps);
  return [Math.round(BEIGE[0] * mix), Math.round(BEIGE[1] * mix), Math.round(BEIGE[2] * mix), 255];
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = sample(x, y, size);
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
console.log("wrote public/icons/icon-192.png, public/icons/icon-512.png, public/apple-touch-icon.png");
