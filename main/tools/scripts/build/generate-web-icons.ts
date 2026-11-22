// main/tools/scripts/build/generate-web-icons.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { REPO_ROOT } from '../../lib/paths';

interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly color: Color;
}

const PUBLIC_DIR = path.join(REPO_ROOT, 'main/apps/web/public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BACKGROUND_TOP: Color = { r: 15, g: 23, b: 42, a: 255 };
const BACKGROUND_BOTTOM: Color = { r: 30, g: 41, b: 59, a: 255 };
const WHITE: Color = { r: 248, g: 250, b: 252, a: 255 };
const SKY: Color = { r: 56, g: 189, b: 248, a: 255 };
const GREEN: Color = { r: 34, g: 197, b: 94, a: 255 };
const AMBER: Color = { r: 245, g: 158, b: 11, a: 255 };

function mix(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function blend(base: Color, overlay: Color): Color {
  const alpha = overlay.a / 255;
  const inverse = 1 - alpha;
  return {
    r: Math.round(overlay.r * alpha + base.r * inverse),
    g: Math.round(overlay.g * alpha + base.g * inverse),
    b: Math.round(overlay.b * alpha + base.b * inverse),
    a: 255,
  };
}

function roundedRectCoverage(px: number, py: number, rect: Rect, size: number): number {
  const x = rect.x * size;
  const y = rect.y * size;
  const width = rect.width * size;
  const height = rect.height * size;
  const radius = rect.radius * size;
  const innerX = Math.max(x + radius, Math.min(px, x + width - radius));
  const innerY = Math.max(y + radius, Math.min(py, y + height - radius));
  const dx = px - innerX;
  const dy = py - innerY;
  const distance = Math.hypot(dx, dy);
  return Math.max(0, Math.min(1, radius + 0.75 - distance));
}

function iconRects(): Rect[] {
  return [
    { x: 0.22, y: 0.2, width: 0.12, height: 0.6, radius: 0.04, color: WHITE },
    { x: 0.36, y: 0.2, width: 0.34, height: 0.14, radius: 0.06, color: SKY },
    { x: 0.36, y: 0.43, width: 0.39, height: 0.14, radius: 0.06, color: GREEN },
    { x: 0.36, y: 0.66, width: 0.32, height: 0.14, radius: 0.06, color: AMBER },
    { x: 0.64, y: 0.29, width: 0.12, height: 0.19, radius: 0.05, color: SKY },
    { x: 0.66, y: 0.53, width: 0.12, height: 0.18, radius: 0.05, color: GREEN },
  ];
}

function renderPixel(x: number, y: number, size: number): Color {
  const amount = y / Math.max(1, size - 1);
  let color: Color = {
    r: mix(BACKGROUND_TOP.r, BACKGROUND_BOTTOM.r, amount),
    g: mix(BACKGROUND_TOP.g, BACKGROUND_BOTTOM.g, amount),
    b: mix(BACKGROUND_TOP.b, BACKGROUND_BOTTOM.b, amount),
    a: 255,
  };

  for (const rect of iconRects()) {
    const coverage = roundedRectCoverage(x, y, rect, size);
    if (coverage <= 0) continue;
    color = blend(color, { ...rect.color, a: Math.round(rect.color.a * coverage) });
  }

  return color;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createPng(size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const pixel = renderPixel(x + 0.5, y + 0.5, size);
      raw[offset] = pixel.r;
      raw[offset + 1] = pixel.g;
      raw[offset + 2] = pixel.b;
      raw[offset + 3] = pixel.a;
      offset += 4;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcons(): void {
  mkdirSync(ICONS_DIR, { recursive: true });

  writeFileSync(path.join(ICONS_DIR, 'logo192.png'), createPng(192));
  writeFileSync(path.join(ICONS_DIR, 'logo512.png'), createPng(512));
}

/** Writes the placeholder-free web app icons. */
export function run(): void {
  writeIcons();
  process.stdout.write('Generated web app icons.\n');
}
