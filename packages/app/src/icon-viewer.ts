import type { Buffer } from "buffer";
import { readNullTerminatedAscii } from "@psv-exporter/core/browser";

export interface IconSysView {
  title: string;
  secondLineOffset: number;
  transparency: number;
  colors: {
    upperLeft: string;
    upperRight: string;
    lowerLeft: string;
    lowerRight: string;
  };
  lightColors: string[];
  iconName: string;
  copyIconName: string;
  deleteIconName: string;
}

export interface ParsedIconModel {
  animationShapes: number;
  textureType: number;
  vertexCount: number;
  vertices: Array<{
    shapes: Array<[number, number, number]>;
    normal: [number, number, number];
    uv: [number, number];
    color: [number, number, number, number];
  }>;
  texture: Uint8ClampedArray;
  animationFrames: number[];
  compressedTexture: boolean;
  textureVOffset: number;
  zScale: 1 | -1;
}


export const PS2_TEXTURE_PAGE_WIDTH = 128;
export const PS2_TEXTURE_PAGE_HEIGHT = 128;
interface TextureDecodeResult {
  words: number[];
  compressed: boolean;
}

function decodeShiftJis(raw: Buffer): string {
  const nul = raw.indexOf(0);
  const end = nul === -1 ? raw.length : nul;
  const bytes = raw.subarray(0, end);

  try {
    return new TextDecoder("shift-jis").decode(bytes);
  } catch {
    return bytes.toString("ascii");
  }
}

function colorVector(data: Buffer, offset: number): string {
  const scale = (value: number): number => Math.max(0, Math.min(255, Math.round((value / 128) * 255)));
  const r = data.length >= offset + 4 ? data.readInt32LE(offset) : 0;
  const g = data.length >= offset + 8 ? data.readInt32LE(offset + 4) : 0;
  const b = data.length >= offset + 12 ? data.readInt32LE(offset + 8) : 0;
  return `rgb(${scale(r)} ${scale(g)} ${scale(b)})`;
}

export function colorVectorComponents(data: Buffer, offset: number): [number, number, number] {
  const scale = (value: number): number => Math.max(0, Math.min(1, value / 128));
  const r = data.length >= offset + 4 ? data.readInt32LE(offset) : 0;
  const g = data.length >= offset + 8 ? data.readInt32LE(offset + 4) : 0;
  const b = data.length >= offset + 12 ? data.readInt32LE(offset + 8) : 0;
  return [scale(r), scale(g), scale(b)];
}

export function parseIconSys(data: Buffer): IconSysView | undefined {
  if (data.length < 452 || data.subarray(0, 4).toString("ascii") !== "PS2D") {
    return undefined;
  }

  const secondLineOffset = data.readUInt16LE(6);
  const titleRaw = data.subarray(192, 260);
  let title = decodeShiftJis(titleRaw);
  if (secondLineOffset > 0 && secondLineOffset < titleRaw.length) {
    const firstLine = decodeShiftJis(titleRaw.subarray(0, secondLineOffset));
    const secondLine = decodeShiftJis(titleRaw.subarray(secondLineOffset));
    title = [firstLine, secondLine].filter(Boolean).join("\n");
  }

  return {
    title: title.trim() || "Untitled save",
    secondLineOffset,
    transparency: data.readInt32LE(12),
    colors: {
      upperLeft: colorVector(data, 16),
      upperRight: colorVector(data, 32),
      lowerLeft: colorVector(data, 48),
      lowerRight: colorVector(data, 64),
    },
    lightColors: [colorVector(data, 128), colorVector(data, 144), colorVector(data, 160), colorVector(data, 176)],
    iconName: readNullTerminatedAscii(data.subarray(260, 324)),
    copyIconName: readNullTerminatedAscii(data.subarray(324, 388)),
    deleteIconName: readNullTerminatedAscii(data.subarray(388, 452)),
  };
}

function readF16(data: Buffer, offset: number): number {
  return data.readInt16LE(offset) / 4096;
}

function readUvF16(data: Buffer, offset: number): number {
  return data.readInt16LE(offset) / 4096;
}

function textureTypeHasCompressedTexture(textureType: number): boolean {
  return (textureType & 0x08) !== 0;
}

function readTextureWordsWithEndian(
  iconData: Buffer,
  offset: number,
  textureType: number,
  endian: "le" | "be",
  sizeEndian: "le" | "be" = "be",
): TextureDecodeResult | undefined {
  const readUInt16 = (cursor: number): number =>
    endian === "le" ? iconData.readUInt16LE(cursor) : iconData.readUInt16BE(cursor);
  const readUInt32 = (cursor: number): number =>
    sizeEndian === "le" ? iconData.readUInt32LE(cursor) : iconData.readUInt32BE(cursor);

  if (!textureTypeHasCompressedTexture(textureType)) {
    if (offset + 128 * 128 * 2 > iconData.length) {
      return undefined;
    }
    const words: number[] = [];
    for (let index = 0; index < 128 * 128; index += 1) {
      words.push(readUInt16(offset + index * 2));
    }
    return { words, compressed: false };
  }

  if (offset + 6 > iconData.length) {
    return undefined;
  }

  const compressedSize = readUInt32(offset);
  let cursor = offset + 4;
  const end = Math.min(iconData.length, cursor + compressedSize);
  const words: number[] = [];

  while (cursor + 2 <= end && words.length < 128 * 128) {
    const code = readUInt16(cursor);
    cursor += 2;

    if (code < 0xff00) {
      if (cursor + 2 > end) {
        break;
      }
      const value = readUInt16(cursor);
      cursor += 2;
      for (let count = 0; count < code && words.length < 128 * 128; count += 1) {
        words.push(value);
      }
      continue;
    }

    const count = 0xffff - code + 1;
    for (let index = 0; index < count && cursor + 2 <= end && words.length < 128 * 128; index += 1) {
      words.push(readUInt16(cursor));
      cursor += 2;
    }
  }

  return words.length === 128 * 128 ? { words, compressed: true } : undefined;
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

function readTextureWords(iconData: Buffer, offset: number, textureType: number): TextureDecodeResult | undefined {
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

  return variants.sort((left, right) => textureScore(right) - textureScore(left))[0];
}

function textureBytesFromWords(words: number[], options?: { flipY?: boolean }): Uint8ClampedArray {
  const texture = new Uint8ClampedArray(PS2_TEXTURE_PAGE_WIDTH * PS2_TEXTURE_PAGE_HEIGHT * 4);

  for (let index = 0; index < words.length; index += 1) {
    const sourceX = index % PS2_TEXTURE_PAGE_WIDTH;
    const sourceY = Math.floor(index / PS2_TEXTURE_PAGE_WIDTH);
    const targetY = options?.flipY ? PS2_TEXTURE_PAGE_HEIGHT - 1 - sourceY : sourceY;
    const targetIndex = targetY * PS2_TEXTURE_PAGE_WIDTH + sourceX;
    const value = words[index] ?? 0;
    const output = targetIndex * 4;
    texture[output] = Math.min(255, (value & 0x1f) * 8);
    texture[output + 1] = Math.min(255, ((value >> 5) & 0x1f) * 8);
    texture[output + 2] = Math.min(255, ((value >> 10) & 0x1f) * 8);
    texture[output + 3] = 255;
  }

  return texture;
}

export function parseIconModel(iconData: Buffer): ParsedIconModel | undefined {
  if (iconData.length < 40) {
    return undefined;
  }

  const iconId = iconData.readUInt32LE(0);
  if (iconId !== 0x00010000 && iconId !== 0x00000100) {
    return undefined;
  }

  const animationShapes = iconData.readUInt32LE(4);
  const textureType = iconData.readUInt32LE(8);
  const vertexCount = iconData.readUInt32LE(16);
  const vertexSize = animationShapes * 8 + 16;
  let offset = 20 + vertexCount * vertexSize;

  if (animationShapes <= 0 || vertexCount <= 0 || offset + 20 > iconData.length) {
    return undefined;
  }

  const vertices: ParsedIconModel["vertices"] = [];
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const vertexOffset = 20 + vertexIndex * vertexSize;
    const shapes: Array<[number, number, number]> = [];

    for (let shape = 0; shape < animationShapes; shape += 1) {
      const shapeOffset = vertexOffset + shape * 8;
      shapes.push([readF16(iconData, shapeOffset), readF16(iconData, shapeOffset + 2), readF16(iconData, shapeOffset + 4)]);
    }

    const normalOffset = vertexOffset + animationShapes * 8;
    const uvOffset = normalOffset + 8;
    const rawU = readUvF16(iconData, uvOffset);
    const rawV = readUvF16(iconData, uvOffset + 2);

    vertices.push({
      shapes,
      normal: [readF16(iconData, normalOffset), readF16(iconData, normalOffset + 2), readF16(iconData, normalOffset + 4)],
      uv: [rawU, rawV],
      color: [
        (iconData[uvOffset + 4] ?? 128) / 128,
        (iconData[uvOffset + 5] ?? 128) / 128,
        (iconData[uvOffset + 6] ?? 128) / 128,
        (iconData[uvOffset + 7] ?? 128) / 128,
      ],
    });
  }

  const frameCount = iconData.readUInt32LE(offset + 16);
  offset += 20;
  const animationFrames: number[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (offset + 8 > iconData.length) {
      return undefined;
    }
    const shapeId = iconData.readUInt32LE(offset);
    const keyCount = iconData.readUInt32LE(offset + 4);
    animationFrames.push(Math.max(0, Math.min(animationShapes - 1, shapeId - 1)));
    offset += 8 + keyCount * 8;
  }

  if (!textureTypeHasCompressedTexture(textureType) && iconData.length >= PS2_TEXTURE_PAGE_WIDTH * PS2_TEXTURE_PAGE_HEIGHT * 2) {
    const uncompressedTextureOffset = iconData.length - PS2_TEXTURE_PAGE_WIDTH * PS2_TEXTURE_PAGE_HEIGHT * 2;
    if (uncompressedTextureOffset > 20) {
      offset = uncompressedTextureOffset;
    }
  }

  const textureResult = readTextureWords(iconData, offset, textureType);

  if (!textureResult) {
    return undefined;
  }

  return {
    animationShapes,
    textureType,
    vertexCount,
    vertices,
    texture: textureBytesFromWords(textureResult.words),
    animationFrames: animationFrames.length > 0 ? animationFrames : Array.from({ length: animationShapes }, (_, index) => index),
    compressedTexture: textureResult.compressed,
    textureVOffset: 0,
    zScale: -1,
  };
}
