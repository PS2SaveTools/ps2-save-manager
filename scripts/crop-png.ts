import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [inputPath, outputPath, rawX, rawY, rawWidth, rawHeight] = process.argv.slice(2);
if (!inputPath || !outputPath || !rawX || !rawY || !rawWidth || !rawHeight) {
  throw new Error("Usage: crop-png <input> <output> <x> <y> <width> <height>");
}

const input = PNG.sync.read(readFileSync(inputPath));
const x = Number(rawX);
const y = Number(rawY);
const width = Number(rawWidth);
const height = Number(rawHeight);
if (x < 0 || y < 0 || x + width > input.width || y + height > input.height) {
  throw new Error(`Crop ${x},${y} ${width}x${height} is outside ${input.width}x${input.height}`);
}

const output = new PNG({ width, height, colorType: 6 });
PNG.bitblt(input, output, x, y, width, height, 0, 0);
writeFileSync(outputPath, PNG.sync.write(output));
