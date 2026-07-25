import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { PNG } from "pngjs";
import { MaxReader, PsvReader, type SaveEntry } from "../packages/core/src/index";

const textureSize = 128;
const textureWords = textureSize * textureSize;

function loadEntries(path: string): SaveEntry[] {
  const input = readFileSync(path);
  const extension = extname(path).toLowerCase();
  if (extension === ".icn") {
    return [{ name: path.split("/").pop() ?? "icon.icn", size: input.length, data: input }];
  }
  if (extension === ".max") {
    return new MaxReader().read(input).entries.map((entry) => ({ name: entry.name, size: entry.size, data: entry.data }));
  }
  if (extension === ".psv") {
    return new PsvReader().read(input).entries;
  }
  throw new Error(`Unsupported save extension: ${extension}`);
}

function readNullTerminatedAscii(raw: Buffer): string {
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString("ascii");
}

function readF16(data: Buffer, offset: number): number {
  return data.readInt16LE(offset) / 4096;
}

function readTextureWords(iconData: Buffer, offset: number, textureType: number): number[] {
  const words: number[] = [];
  if ((textureType & 0x08) === 0) {
    for (let index = 0; index < textureWords; index += 1) {
      words.push(iconData.readUInt16LE(offset + index * 2));
    }
    return words;
  }

  const compressedSize = iconData.readUInt32BE(offset);
  let cursor = offset + 4;
  const end = Math.min(iconData.length, cursor + compressedSize);
  while (cursor + 2 <= end && words.length < textureWords) {
    const code = iconData.readUInt16LE(cursor);
    cursor += 2;
    if (code < 0xff00) {
      if (cursor + 2 > end) {
        break;
      }
      const value = iconData.readUInt16LE(cursor);
      cursor += 2;
      for (let count = 0; count < code && words.length < textureWords; count += 1) {
        words.push(value);
      }
      continue;
    }
    const count = 0xffff - code + 1;
    for (let index = 0; index < count && cursor + 2 <= end && words.length < textureWords; index += 1) {
      words.push(iconData.readUInt16LE(cursor));
      cursor += 2;
    }
  }
  return words;
}

function rgb(word: number): [number, number, number] {
  return [
    Math.min(255, (word & 0x1f) * 8),
    Math.min(255, ((word >> 5) & 0x1f) * 8),
    Math.min(255, ((word >> 10) & 0x1f) * 8),
  ];
}

function writeTexturePng(path: string, words: number[]): void {
  const png = new PNG({ width: textureSize, height: textureSize, colorType: 6 });
  for (let index = 0; index < textureWords; index += 1) {
    const [r, g, b] = rgb(words[index] ?? 0);
    const output = index * 4;
    png.data[output] = r;
    png.data[output + 1] = g;
    png.data[output + 2] = b;
    png.data[output + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

function topColors(words: number[]): Array<{ word: string; count: number; rgb: [number, number, number] }> {
  const counts = new Map<number, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([word, count]) => ({ word: `0x${word.toString(16).padStart(4, "0")}`, count, rgb: rgb(word) }));
}

const [savePath, requestedTexturePath] = process.argv.slice(2);
if (!savePath) {
  throw new Error("Usage: inspect-icon-texture <save.max|save.psv|icon.icn>");
}

const entries = loadEntries(savePath);
const iconSys = entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
const iconName = iconSys ? readNullTerminatedAscii(iconSys.data.subarray(260, 324)) : undefined;
const icon = entries.find((entry) => entry.name.toLowerCase() === iconName?.toLowerCase())
  ?? entries.find((entry) => entry.name.toLowerCase() !== "icon.sys" && entry.data.length >= 20 && [0x10000, 0x100].includes(entry.data.readUInt32LE(0)));

if (!icon) {
  throw new Error("No icon model found");
}

const data = icon.data;
const shapes = data.readUInt32LE(4);
const textureType = data.readUInt32LE(8);
const vertexCount = data.readUInt32LE(16);
const vertexSize = shapes * 8 + 16;
let offset = 20 + vertexCount * vertexSize;
const frameCount = data.readUInt32LE(offset + 16);
offset += 20;
const frames = [];
for (let frame = 0; frame < frameCount; frame += 1) {
  const shapeId = data.readUInt32LE(offset);
  const keyCount = data.readUInt32LE(offset + 4);
  frames.push({ frame, offset, shapeId, keyCount });
  offset += 8 + keyCount * 8;
}

let minU = Infinity;
let maxU = -Infinity;
let minV = Infinity;
let maxV = -Infinity;
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const vertexOffset = 20 + vertex * vertexSize;
  const uvOffset = vertexOffset + shapes * 8 + 8;
  minX = Math.min(minX, readF16(data, vertexOffset));
  maxX = Math.max(maxX, readF16(data, vertexOffset));
  minY = Math.min(minY, readF16(data, vertexOffset + 2));
  maxY = Math.max(maxY, readF16(data, vertexOffset + 2));
  minZ = Math.min(minZ, readF16(data, vertexOffset + 4));
  maxZ = Math.max(maxZ, readF16(data, vertexOffset + 4));
  const u = data.readUInt16LE(uvOffset) / 4096;
  const v = data.readUInt16LE(uvOffset + 2) / 4096;
  minU = Math.min(minU, u);
  maxU = Math.max(maxU, u);
  minV = Math.min(minV, v);
  maxV = Math.max(maxV, v);
}

const words = readTextureWords(data, offset, textureType);
const texturePath = requestedTexturePath ?? `${icon.name}.texture.png`;
writeTexturePng(texturePath, words);

console.log(JSON.stringify({
  icon: icon.name,
  shapes,
  textureType,
  vertexCount,
  frameCount,
  frames,
  textureOffset: offset,
  bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  uv: { minU, maxU, minV, maxV },
  topColors: topColors(words),
  texturePath,
}, null, 2));
