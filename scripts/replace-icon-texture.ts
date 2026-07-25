import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const TEXTURE_SIZE = 128;
const TEXTURE_WORDS = TEXTURE_SIZE * TEXTURE_SIZE;

function textureOffset(data: Buffer): number {
  const shapes = data.readUInt32LE(4);
  const vertices = data.readUInt32LE(16);
  let offset = 20 + vertices * (shapes * 8 + 16);
  const frameCount = data.readUInt32LE(offset + 16);
  offset += 20;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const keyCount = data.readUInt32LE(offset + 4);
    offset += 8 + keyCount * 8;
  }
  return offset;
}

function textureWords(png: PNG): number[] {
  if (png.width !== TEXTURE_SIZE || png.height !== TEXTURE_SIZE) {
    throw new Error(`Texture must be ${TEXTURE_SIZE}x${TEXTURE_SIZE}, got ${png.width}x${png.height}`);
  }
  const words: number[] = [];
  for (let pixel = 0; pixel < TEXTURE_WORDS; pixel += 1) {
    const offset = pixel * 4;
    const r = Math.round(png.data[offset] / 8) & 0x1f;
    const g = Math.round(png.data[offset + 1] / 8) & 0x1f;
    const b = Math.round(png.data[offset + 2] / 8) & 0x1f;
    words.push(r | (g << 5) | (b << 10));
  }
  return words;
}

function encodeCompressed(words: number[]): Buffer {
  const chunks: Buffer[] = [];
  let cursor = 0;
  while (cursor < words.length) {
    let run = 1;
    while (cursor + run < words.length && words[cursor + run] === words[cursor] && run < 0xfeff) {
      run += 1;
    }
    if (run >= 2) {
      const chunk = Buffer.alloc(4);
      chunk.writeUInt16LE(run, 0);
      chunk.writeUInt16LE(words[cursor], 2);
      chunks.push(chunk);
      cursor += run;
      continue;
    }

    const literalStart = cursor;
    cursor += 1;
    while (cursor < words.length && cursor - literalStart < 256) {
      let nextRun = 1;
      while (cursor + nextRun < words.length && words[cursor + nextRun] === words[cursor] && nextRun < 2) {
        nextRun += 1;
      }
      if (nextRun >= 2) break;
      cursor += 1;
    }
    const count = cursor - literalStart;
    const chunk = Buffer.alloc(2 + count * 2);
    chunk.writeUInt16LE(0xffff - count + 1, 0);
    for (let index = 0; index < count; index += 1) {
      chunk.writeUInt16LE(words[literalStart + index], 2 + index * 2);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const [iconPath, pngPath] = process.argv.slice(2);
if (!iconPath || !pngPath) {
  throw new Error("Usage: replace-icon-texture <icon.icn> <128x128.png>");
}

const icon = readFileSync(iconPath);
if ((icon.readUInt32LE(8) & 0x08) === 0) {
  throw new Error("This utility currently expects a compressed PS2 icon texture");
}
const offset = textureOffset(icon);
const png = PNG.sync.read(readFileSync(pngPath));
const payload = encodeCompressed(textureWords(png));
const size = Buffer.alloc(4);
size.writeUInt32BE(payload.length);
writeFileSync(iconPath, Buffer.concat([icon.subarray(0, offset), size, payload]));
console.log(JSON.stringify({ iconPath, textureOffset: offset, compressedBytes: payload.length }));
