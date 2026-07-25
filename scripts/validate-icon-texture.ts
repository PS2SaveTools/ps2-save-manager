import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { PNG } from "pngjs";
import { MaxReader, PsvReader, type SaveEntry } from "../packages/core/src/index";

const TEXTURE_WIDTH = 128;
const TEXTURE_HEIGHT = 128;
const TEXTURE_WORDS = TEXTURE_WIDTH * TEXTURE_HEIGHT;

interface TextureDecodeResult {
  words: number[];
  compressed: boolean;
}

function readNullTerminatedAscii(raw: Buffer): string {
  const nul = raw.indexOf(0);
  const end = nul === -1 ? raw.length : nul;
  return raw.subarray(0, end).toString("ascii");
}

function readTextureWordsWithEndian(
  iconData: Buffer,
  offset: number,
  textureType: number,
  wordEndian: "le" | "be",
  sizeEndian: "le" | "be" = "be",
): TextureDecodeResult | undefined {
  const readUInt16 = (cursor: number): number =>
    wordEndian === "le" ? iconData.readUInt16LE(cursor) : iconData.readUInt16BE(cursor);
  const readUInt32 = (cursor: number): number =>
    sizeEndian === "le" ? iconData.readUInt32LE(cursor) : iconData.readUInt32BE(cursor);

  if ((textureType & 0x08) === 0) {
    if (offset + TEXTURE_WORDS * 2 > iconData.length) {
      return undefined;
    }

    return {
      compressed: false,
      words: Array.from({ length: TEXTURE_WORDS }, (_, index) => readUInt16(offset + index * 2)),
    };
  }

  if (offset + 6 > iconData.length) {
    return undefined;
  }

  const compressedSize = readUInt32(offset);
  let cursor = offset + 4;
  const end = Math.min(iconData.length, cursor + compressedSize);
  const words: number[] = [];

  while (cursor + 2 <= end && words.length < TEXTURE_WORDS) {
    const code = readUInt16(cursor);
    cursor += 2;

    if (code < 0xff00) {
      if (cursor + 2 > end) {
        break;
      }

      const value = readUInt16(cursor);
      cursor += 2;
      for (let count = 0; count < code && words.length < TEXTURE_WORDS; count += 1) {
        words.push(value);
      }
      continue;
    }

    const count = 0xffff - code + 1;
    for (let index = 0; index < count && cursor + 2 <= end && words.length < TEXTURE_WORDS; index += 1) {
      words.push(readUInt16(cursor));
      cursor += 2;
    }
  }

  return words.length === TEXTURE_WORDS ? { compressed: true, words } : undefined;
}

function textureScore(result: TextureDecodeResult): number {
  let nonZero = 0;
  const unique = new Set<number>();

  for (const word of result.words) {
    if (word !== 0) {
      nonZero += 1;
    }
    unique.add(word);
  }

  return nonZero + unique.size * 16;
}

function decodeTextureWords(iconData: Buffer, offset: number, textureType: number): TextureDecodeResult {
  const preferredLittleEndianWords = [
    readTextureWordsWithEndian(iconData, offset, textureType, "le", "be"),
    readTextureWordsWithEndian(iconData, offset, textureType, "le", "le"),
  ].filter((result): result is TextureDecodeResult => Boolean(result));

  if (preferredLittleEndianWords.length > 0) {
    return preferredLittleEndianWords[0];
  }

  const variants = [
    readTextureWordsWithEndian(iconData, offset, textureType, "be", "be"),
    readTextureWordsWithEndian(iconData, offset, textureType, "be", "le"),
  ].filter((result): result is TextureDecodeResult => Boolean(result));

  const best = variants.sort((left, right) => textureScore(right) - textureScore(left))[0];

  if (!best) {
    throw new Error("Unable to decode icon texture");
  }

  return best;
}

function textureBytesFromWords(words: number[], options?: { flipY?: boolean }): Uint8ClampedArray {
  const texture = new Uint8ClampedArray(TEXTURE_WORDS * 4);

  for (let index = 0; index < words.length; index += 1) {
    const sourceX = index % TEXTURE_WIDTH;
    const sourceY = Math.floor(index / TEXTURE_WIDTH);
    const targetY = options?.flipY ? TEXTURE_HEIGHT - 1 - sourceY : sourceY;
    const targetIndex = targetY * TEXTURE_WIDTH + sourceX;
    const value = words[index] ?? 0;
    const output = targetIndex * 4;

    texture[output] = Math.min(255, (value & 0x1f) * 8);
    texture[output + 1] = Math.min(255, ((value >> 5) & 0x1f) * 8);
    texture[output + 2] = Math.min(255, ((value >> 10) & 0x1f) * 8);
    texture[output + 3] = 255;
  }

  return texture;
}

function textureOffset(iconData: Buffer): { offset: number; textureType: number } {
  const animationShapes = iconData.readUInt32LE(4);
  const textureType = iconData.readUInt32LE(8);
  const vertexCount = iconData.readUInt32LE(16);
  const vertexSize = animationShapes * 8 + 16;
  let offset = 20 + vertexCount * vertexSize;
  const frameCount = iconData.readUInt32LE(offset + 16);
  offset += 20;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const keyCount = iconData.readUInt32LE(offset + 4);
    offset += 8 + keyCount * 8;
  }

  if ((textureType & 0x08) === 0 && iconData.length >= TEXTURE_WORDS * 2) {
    offset = iconData.length - TEXTURE_WORDS * 2;
  }

  return { offset, textureType };
}

function loadEntries(savePath: string): SaveEntry[] {
  const input = readFileSync(savePath);
  const extension = extname(savePath).toLowerCase();

  if (extension === ".max") {
    return new MaxReader().read(input).entries.map((entry) => ({
      name: entry.name,
      size: entry.size,
      data: entry.data,
    }));
  }

  if (extension === ".psv") {
    return new PsvReader().read(input).entries;
  }

  throw new Error(`Unsupported save extension: ${extension}`);
}

function findIconEntry(entries: SaveEntry[], requestedName?: string): SaveEntry {
  const iconSys = entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
  const iconSysName = iconSys ? readNullTerminatedAscii(iconSys.data.subarray(260, 324)) : undefined;
  const names = [requestedName, iconSysName].filter((name): name is string => Boolean(name));

  for (const name of names) {
    const exact = entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (exact) {
      return exact;
    }
  }

  const candidate = entries.find((entry) => {
    if (entry.name.toLowerCase() === "icon.sys" || entry.data.length < 20) {
      return false;
    }
    const id = entry.data.readUInt32LE(0);
    return id === 0x00010000 || id === 0x00000100;
  });

  if (!candidate) {
    throw new Error("No icon model entry found");
  }

  return candidate;
}

function meanSquaredError(actual: Uint8ClampedArray, expected: Buffer): number {
  let total = 0;

  for (let index = 0; index < actual.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const diff = (actual[index + channel] ?? 0) - (expected[index + channel] ?? 0);
      total += diff * diff;
    }
  }

  return total / (TEXTURE_WORDS * 3);
}

const [savePath, expectedPngPath, iconName] = process.argv.slice(2);

if (!savePath || !expectedPngPath) {
  throw new Error("Usage: validate-icon-texture <save.max|save.psv> <expected.png> [icon-name]");
}

const iconEntry = findIconEntry(loadEntries(savePath), iconName);
const { offset, textureType } = textureOffset(iconEntry.data);
const result = decodeTextureWords(iconEntry.data, offset, textureType);
const actual = textureBytesFromWords(result.words);
const expected = PNG.sync.read(readFileSync(expectedPngPath));

if (expected.width !== TEXTURE_WIDTH || expected.height !== TEXTURE_HEIGHT) {
  throw new Error(`Expected PNG must be ${TEXTURE_WIDTH}x${TEXTURE_HEIGHT}, got ${expected.width}x${expected.height}`);
}

const mse = meanSquaredError(actual, expected.data);
console.log(
  JSON.stringify(
    {
      icon: iconEntry.name,
      textureType,
      compressed: result.compressed,
      mse,
      pass: mse < 3500,
    },
    null,
    2,
  ),
);

if (mse >= 3500) {
  process.exitCode = 1;
}
