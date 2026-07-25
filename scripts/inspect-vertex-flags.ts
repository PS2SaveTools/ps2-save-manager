import { readFileSync } from "node:fs";
import { MaxReader } from "../packages/core/src/index";

const [savePath, iconName = "icon"] = process.argv.slice(2);
if (!savePath) {
  throw new Error("Usage: inspect-vertex-flags <save.max> [icon-name]");
}

const save = new MaxReader().read(readFileSync(savePath));
const icon = save.entries.find((entry) => entry.name === iconName);
if (!icon) throw new Error(`${iconName} not found`);

const data = icon.data;
const shapes = data.readUInt32LE(4);
const vertexCount = data.readUInt32LE(16);
const vertexSize = shapes * 8 + 16;
const positionW = new Map<number, number>();
const normalW = new Map<number, number>();
const colorA = new Map<number, number>();
const samples = [];

for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const vertexOffset = 20 + vertex * vertexSize;
  const normalOffset = vertexOffset + shapes * 8;
  const uvOffset = normalOffset + 8;
  const w = data.readUInt16LE(vertexOffset + 6);
  const nw = data.readUInt16LE(normalOffset + 6);
  const a = data[uvOffset + 7] ?? 0;
  positionW.set(w, (positionW.get(w) ?? 0) + 1);
  normalW.set(nw, (normalW.get(nw) ?? 0) + 1);
  colorA.set(a, (colorA.get(a) ?? 0) + 1);
  if (vertex < 80 || w !== 0 || nw !== 0) {
    samples.push({
      vertex,
      positionW: w,
      normalW: nw,
      colorA: a,
      xyz: [
        data.readInt16LE(vertexOffset) / 4096,
        data.readInt16LE(vertexOffset + 2) / 4096,
        data.readInt16LE(vertexOffset + 4) / 4096,
      ],
      uv: [data.readUInt16LE(uvOffset) / 4096, data.readUInt16LE(uvOffset + 2) / 4096],
    });
  }
}

console.log(JSON.stringify({
  vertexCount,
  positionW: [...positionW.entries()].sort((a, b) => a[0] - b[0]),
  normalW: [...normalW.entries()].sort((a, b) => a[0] - b[0]),
  colorA: [...colorA.entries()].sort((a, b) => a[0] - b[0]),
  samples: samples.slice(0, 180),
}, null, 2));
