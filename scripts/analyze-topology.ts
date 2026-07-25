import { readFileSync } from "node:fs";
import { MaxReader } from "../packages/core/src/index";

const [savePath, iconName = "icon"] = process.argv.slice(2);
if (!savePath) {
  throw new Error("Usage: analyze-topology <save.max> [icon-name]");
}

const save = new MaxReader().read(readFileSync(savePath));
const icon = save.entries.find((entry) => entry.name === iconName);
if (!icon) throw new Error(`${iconName} not found`);

const data = icon.data;
const shapes = data.readUInt32LE(4);
const vertexCount = data.readUInt32LE(16);
const vertexSize = shapes * 8 + 16;

function readF16(offset: number): number {
  return data.readInt16LE(offset) / 4096;
}

const degenerate = [];
const jumps = [];
for (let i = 0; i < vertexCount; i += 1) {
  const offset = 20 + i * vertexSize;
  const x = readF16(offset);
  const y = readF16(offset + 2);
  const z = readF16(offset + 4);
  const u = data.readUInt16LE(offset + shapes * 8 + 8) / 4096;
  const v = data.readUInt16LE(offset + shapes * 8 + 10) / 4096;
  if (i > 0) {
    const prevOffset = 20 + (i - 1) * vertexSize;
    const dx = x - readF16(prevOffset);
    const dy = y - readF16(prevOffset + 2);
    const dz = z - readF16(prevOffset + 4);
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 1.5) jumps.push({ i, dist, x, y, z, u, v });
  }
  if (i >= 2) {
    const aOffset = 20 + (i - 2) * vertexSize;
    const bOffset = 20 + (i - 1) * vertexSize;
    const ax = readF16(aOffset), ay = readF16(aOffset + 2), az = readF16(aOffset + 4);
    const bx = readF16(bOffset), by = readF16(bOffset + 2), bz = readF16(bOffset + 4);
    const ab = [bx - ax, by - ay, bz - az];
    const ac = [x - ax, y - ay, z - az];
    const area = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    );
    if (area < 0.0001) degenerate.push(i);
  }
}

console.log(JSON.stringify({
  vertexCount,
  trianglesByList: Math.floor(vertexCount / 3),
  trianglesByStrip: Math.max(0, vertexCount - 2),
  degenerateStripTriangles: degenerate.length,
  firstDegenerateIndices: degenerate.slice(0, 40),
  largeSequentialJumps: jumps.slice(0, 40),
}, null, 2));
