import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { PNG } from "pngjs";
import { MaxReader, PsvReader, type SaveEntry } from "../packages/core/src/index";

const TEXTURE_WIDTH = 128;
const TEXTURE_HEIGHT = 128;
const TEXTURE_WORDS = TEXTURE_WIDTH * TEXTURE_HEIGHT;
const RENDER_SIZE = 512;

type Endian = "le" | "be";
type WrapMode = "clamp" | "repeat";

interface TextureDecodeResult {
  words: number[];
  compressed: boolean;
}

interface ParsedIconModel {
  textureType: number;
  vertices: Array<{
    position: [number, number, number];
    uv: [number, number];
  }>;
  texture: Uint8ClampedArray;
}

interface RenderOptions {
  flipU: boolean;
  flipV: boolean;
  offsetV: number;
  wrap: WrapMode;
}

interface ValidationMetrics {
  featureCenterY: number;
  featureCoverage: number;
  topDarkCoverage: number;
}

interface CandidateResult extends ValidationMetrics {
  score: number;
  options: RenderOptions;
}

function readNullTerminatedAscii(raw: Buffer): string {
  const nul = raw.indexOf(0);
  const end = nul === -1 ? raw.length : nul;
  return raw.subarray(0, end).toString("ascii");
}

function readF16(data: Buffer, offset: number): number {
  return data.readInt16LE(offset) / 4096;
}

function readUvF16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset) / 4096;
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

function readTextureWordsWithEndian(
  iconData: Buffer,
  offset: number,
  textureType: number,
  wordEndian: Endian,
  sizeEndian: Endian = "be",
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

function readTextureWords(iconData: Buffer, offset: number, textureType: number): TextureDecodeResult {
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

function parseIconModel(iconData: Buffer): ParsedIconModel {
  if (iconData.length < 40) {
    throw new Error("Icon model is too small");
  }

  const iconId = iconData.readUInt32LE(0);
  if (iconId !== 0x00010000 && iconId !== 0x00000100) {
    throw new Error("Icon model header is not recognized");
  }

  const animationShapes = iconData.readUInt32LE(4);
  const textureType = iconData.readUInt32LE(8);
  const vertexCount = iconData.readUInt32LE(16);
  const vertexSize = animationShapes * 8 + 16;
  let offset = 20 + vertexCount * vertexSize;

  if (animationShapes <= 0 || vertexCount <= 0 || offset + 20 > iconData.length) {
    throw new Error("Icon model vertex table is invalid");
  }

  const vertices: ParsedIconModel["vertices"] = [];

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const vertexOffset = 20 + vertexIndex * vertexSize;
    const normalOffset = vertexOffset + animationShapes * 8;
    const uvOffset = normalOffset + 8;
    const rawU = readUvF16(iconData, uvOffset);
    const rawV = readUvF16(iconData, uvOffset + 2);

    vertices.push({
      position: [
        readF16(iconData, vertexOffset),
        -readF16(iconData, vertexOffset + 2),
        readF16(iconData, vertexOffset + 4),
      ],
      uv: [rawU, rawV],
    });
  }

  for (const vertex of vertices) {
    vertex.uv = [vertex.uv[0], vertex.uv[1]];
  }

  const frameCount = iconData.readUInt32LE(offset + 16);
  offset += 20;

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (offset + 8 > iconData.length) {
      throw new Error("Icon model animation table is invalid");
    }

    const keyCount = iconData.readUInt32LE(offset + 4);
    offset += 8 + keyCount * 8;
  }

  if ((textureType & 0x08) === 0 && iconData.length >= TEXTURE_WORDS * 2) {
    const uncompressedTextureOffset = iconData.length - TEXTURE_WORDS * 2;
    if (uncompressedTextureOffset > 20) {
      offset = uncompressedTextureOffset;
    }
  }

  const textureResult = readTextureWords(iconData, offset, textureType);

  return {
    textureType,
    vertices,
    texture: textureBytesFromWords(textureResult.words),
  };
}

function wrapCoordinate(value: number, wrap: WrapMode): number {
  if (wrap === "clamp") {
    return Math.max(0, Math.min(1, value));
  }

  return value - Math.floor(value);
}

function sampleTexture(texture: Uint8ClampedArray, u: number, v: number, wrap: WrapMode): [number, number, number, number] {
  const x = Math.round(wrapCoordinate(u, wrap) * (TEXTURE_WIDTH - 1));
  const y = Math.round((1 - wrapCoordinate(v, wrap)) * (TEXTURE_HEIGHT - 1));
  const index = (y * TEXTURE_WIDTH + x) * 4;
  return [texture[index] ?? 0, texture[index + 1] ?? 0, texture[index + 2] ?? 0, texture[index + 3] ?? 255];
}

function transformedUv(uv: [number, number], options: RenderOptions): [number, number] {
  const u = options.flipU ? 1 - uv[0] : uv[0];
  const vBase = options.flipV ? 1 - uv[1] : uv[1];
  return [u, vBase + options.offsetV];
}

function renderIcon(model: ParsedIconModel, options: RenderOptions): PNG {
  const output = new PNG({ width: RENDER_SIZE, height: RENDER_SIZE, colorType: 6 });
  const zBuffer = new Float64Array(RENDER_SIZE * RENDER_SIZE).fill(-Infinity);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const vertex of model.vertices) {
    minX = Math.min(minX, vertex.position[0]);
    maxX = Math.max(maxX, vertex.position[0]);
    minY = Math.min(minY, vertex.position[1]);
    maxY = Math.max(maxY, vertex.position[1]);
  }

  const modelWidth = Math.max(0.001, maxX - minX);
  const modelHeight = Math.max(0.001, maxY - minY);
  const scale = (RENDER_SIZE * 0.9) / Math.max(modelWidth, modelHeight);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const projected = model.vertices.map((vertex) => ({
    x: RENDER_SIZE / 2 + (vertex.position[0] - centerX) * scale,
    y: RENDER_SIZE / 2 - (vertex.position[1] - centerY) * scale,
    z: vertex.position[2],
    uv: transformedUv(vertex.uv, options),
  }));

  for (let triangle = 0; triangle + 2 < projected.length; triangle += 3) {
    const a = projected[triangle]!;
    const b = projected[triangle + 1]!;
    const c = projected[triangle + 2]!;
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

    if (Math.abs(area) < 0.00001) {
      continue;
    }

    const minTriangleX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxTriangleX = Math.min(RENDER_SIZE - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minTriangleY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxTriangleY = Math.min(RENDER_SIZE - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

    for (let y = minTriangleY; y <= maxTriangleY; y += 1) {
      for (let x = minTriangleX; x <= maxTriangleX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;

        if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) {
          continue;
        }

        const z = a.z * w0 + b.z * w1 + c.z * w2;
        const pixel = y * RENDER_SIZE + x;
        if (z < zBuffer[pixel]!) {
          continue;
        }

        zBuffer[pixel] = z;
        const u = a.uv[0] * w0 + b.uv[0] * w1 + c.uv[0] * w2;
        const v = a.uv[1] * w0 + b.uv[1] * w1 + c.uv[1] * w2;
        const [r, g, bValue, alpha] = sampleTexture(model.texture, u, v, options.wrap);
        const outputIndex = pixel * 4;
        output.data[outputIndex] = r;
        output.data[outputIndex + 1] = g;
        output.data[outputIndex + 2] = bValue;
        output.data[outputIndex + 3] = alpha;
      }
    }
  }

  return output;
}

function isFeaturePixel(r: number, g: number, b: number): boolean {
  const whiteEye = r > 170 && g > 170 && b > 170;
  const redMouth = r > 110 && g < 105 && b < 90 && r > b * 1.3;
  return whiteEye || redMouth;
}

function isDarkPixel(r: number, g: number, b: number): boolean {
  return r < 45 && g < 45 && b < 45;
}

function backgroundColor(image: PNG): [number, number, number] {
  const samples: Array<[number, number, number]> = [];
  const points = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ];

  for (const [x, y] of points) {
    const index = (y! * image.width + x!) * 4;
    samples.push([image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0]);
  }

  return [
    samples.reduce((sum, color) => sum + color[0], 0) / samples.length,
    samples.reduce((sum, color) => sum + color[1], 0) / samples.length,
    samples.reduce((sum, color) => sum + color[2], 0) / samples.length,
  ];
}

function colorDistanceSquared(left: [number, number, number], right: [number, number, number]): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;
}

function measureImage(image: PNG): ValidationMetrics {
  const bg = backgroundColor(image);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let modelPixels = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.data[index + 3] ?? 255;
      const color: [number, number, number] = [
        image.data[index] ?? 0,
        image.data[index + 1] ?? 0,
        image.data[index + 2] ?? 0,
      ];
      const isModel = alpha > 20 && (alpha < 250 || colorDistanceSquared(color, bg) > 1300);

      if (!isModel) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      modelPixels += 1;
    }
  }

  if (modelPixels === 0 || !Number.isFinite(minX) || !Number.isFinite(minY)) {
    throw new Error("Unable to find rendered model bounds");
  }

  let featurePixels = 0;
  let featureY = 0;
  let topDarkPixels = 0;
  let topModelPixels = 0;
  const modelHeight = Math.max(1, maxY - minY + 1);
  const topLimit = minY + modelHeight * 0.18;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.data[index + 3] ?? 255;
      const r = image.data[index] ?? 0;
      const g = image.data[index + 1] ?? 0;
      const b = image.data[index + 2] ?? 0;
      const color: [number, number, number] = [r, g, b];
      const isModel = alpha > 20 && (alpha < 250 || colorDistanceSquared(color, bg) > 1300);

      if (!isModel) {
        continue;
      }

      if (y <= topLimit) {
        topModelPixels += 1;
        if (isDarkPixel(r, g, b)) {
          topDarkPixels += 1;
        }
      }

      if (isFeaturePixel(r, g, b)) {
        featurePixels += 1;
        featureY += (y - minY) / modelHeight;
      }
    }
  }

  if (featurePixels === 0) {
    throw new Error("Unable to find face feature pixels in rendered image");
  }

  return {
    featureCenterY: featureY / featurePixels,
    featureCoverage: featurePixels / modelPixels,
    topDarkCoverage: topModelPixels > 0 ? topDarkPixels / topModelPixels : 0,
  };
}

function scoreCandidate(metrics: ValidationMetrics, expected: ValidationMetrics): number {
  const featureCenterPenalty = Math.abs(metrics.featureCenterY - expected.featureCenterY) * 100;
  const coveragePenalty = Math.abs(metrics.featureCoverage - expected.featureCoverage) * 20;
  const topDarkPenalty = Math.max(0, metrics.topDarkCoverage - Math.max(0.02, expected.topDarkCoverage + 0.02)) * 80;
  return featureCenterPenalty + coveragePenalty + topDarkPenalty;
}

function optionCandidates(search: boolean): RenderOptions[] {
  if (!search) {
    return [{ flipU: true, flipV: true, offsetV: -14 / TEXTURE_HEIGHT, wrap: "clamp" }];
  }

  const candidates: RenderOptions[] = [];
  for (const wrap of ["clamp", "repeat"] as const) {
    for (const flipU of [false, true]) {
      for (const flipV of [false, true]) {
        for (let offsetIndex = -8; offsetIndex <= 8; offsetIndex += 1) {
          candidates.push({ flipU, flipV, offsetV: offsetIndex / 64, wrap });
        }
      }
    }
  }
  return candidates;
}

const args = process.argv.slice(2);
const search = args.includes("--search");
const savePath = args.find((arg) => !arg.startsWith("--"));
const expectedPath = args.filter((arg) => !arg.startsWith("--"))[1];
const iconName = args.filter((arg) => !arg.startsWith("--"))[2];

if (!savePath || !expectedPath) {
  throw new Error("Usage: validate-icon-render [--search] <save.max|save.psv> <expected-render.png> [icon-name]");
}

const iconEntry = findIconEntry(loadEntries(savePath), iconName);
const model = parseIconModel(iconEntry.data);
const expectedImage = PNG.sync.read(readFileSync(expectedPath));
const expectedMetrics = measureImage(expectedImage);
const results: CandidateResult[] = optionCandidates(search)
  .map((options) => {
    let metrics: ValidationMetrics;
    try {
      metrics = measureImage(renderIcon(model, options));
    } catch {
      metrics = {
        featureCenterY: Number.POSITIVE_INFINITY,
        featureCoverage: 0,
        topDarkCoverage: 1,
      };
    }
    return {
      ...metrics,
      options,
      score: scoreCandidate(metrics, expectedMetrics),
    };
  })
  .sort((left, right) => left.score - right.score);

const best = results[0]!;
console.log(
  JSON.stringify(
    {
      icon: iconEntry.name,
      textureType: model.textureType,
      expected: expectedMetrics,
      best,
      pass: best.score < 2.5 && best.topDarkCoverage < 0.04,
    },
    null,
    2,
  ),
);

if (best.score >= 2.5 || best.topDarkCoverage >= 0.04) {
  process.exitCode = 1;
}
