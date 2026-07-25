import { Buffer } from "buffer";
import { asciiToShiftJisWord, decodeSjisTitle } from "../formats/sjis";
import type { AppSaveDocument } from "./app-model";

export interface IconSysLight { color: string; x: number; y: number; z: number }
export interface IconSysProperties {
  line1: string; line2: string; viewIcon: string; copyIcon: string; deleteIcon: string;
  transparency: number; background: [string, string, string, string]; ambient: string;
  lights: [IconSysLight, IconSysLight, IconSysLight];
}

function text(data: Buffer, start: number, end: number): string { return data.subarray(start, end).toString("ascii").split("\0")[0]!; }
function color(data: Buffer, offset: number): string {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255 / 128)));
  return `#${[0, 4, 8].map((add) => byte(data.readInt32LE(offset + add)).toString(16).padStart(2, "0")).join("")}`;
}
function writeColor(data: Buffer, offset: number, value: string): void {
  const hex = value.replace(/^#/, "");
  for (let i = 0; i < 3; i += 1) data.writeInt32LE(Math.round(parseInt(hex.slice(i * 2, i * 2 + 2), 16) * 128 / 255), offset + i * 4);
}
function light(data: Buffer, index: number): IconSysLight {
  const direction = 80 + index * 16;
  return { color: color(data, 128 + index * 16), x: data.readFloatLE(direction), y: data.readFloatLE(direction + 4), z: data.readFloatLE(direction + 8) };
}

export function parseIconSysProperties(data: Buffer): IconSysProperties {
  if (data.length < 452 || data.subarray(0, 4).toString("ascii") !== "PS2D") throw new Error("Invalid icon.sys file");
  const raw = data.subarray(192, 260); const split = Math.min(data.readUInt16LE(6), raw.length);
  return {
    line1: decodeSjisTitle(split ? raw.subarray(0, split) : raw), line2: split ? decodeSjisTitle(raw.subarray(split)) : "",
    viewIcon: text(data, 260, 324), copyIcon: text(data, 324, 388), deleteIcon: text(data, 388, 452),
    transparency: data.readInt32LE(12), background: [color(data, 16), color(data, 32), color(data, 48), color(data, 64)],
    ambient: color(data, 176), lights: [light(data, 0), light(data, 1), light(data, 2)],
  };
}

export function updateIconSysProperties(documentModel: AppSaveDocument, properties: IconSysProperties): AppSaveDocument {
  const index = documentModel.entries.findIndex((entry) => entry.name.toLowerCase() === "icon.sys");
  if (index < 0) throw new Error("Save has no icon.sys entry");
  const entries = [...documentModel.entries]; const entry = entries[index]!; const data = Buffer.from(entry.data);
  const title = `${properties.line1}${properties.line2}`;
  if (title.length > 33) throw new Error("Save title must be 33 characters or fewer");
  data.fill(0, 192, 260); title.split("").forEach((char, i) => data.writeUInt16LE(asciiToShiftJisWord(char), 192 + i * 2));
  data.writeUInt16LE(properties.line2 ? properties.line1.length * 2 : 0, 6);
  for (const [value, start] of [[properties.viewIcon, 260], [properties.copyIcon, 324], [properties.deleteIcon, 388]] as const) {
    if (Buffer.byteLength(value, "ascii") > 63) throw new Error("Icon filename must be 63 bytes or fewer"); data.fill(0, start, start + 64); data.write(value, start, "ascii");
  }
  data.writeInt32LE(Math.max(0, Math.min(255, Math.round(properties.transparency))), 12);
  properties.background.forEach((value, i) => writeColor(data, 16 + i * 16, value)); writeColor(data, 176, properties.ambient);
  properties.lights.forEach((item, i) => { const o = 80 + i * 16; data.writeFloatLE(item.x, o); data.writeFloatLE(item.y, o + 4); data.writeFloatLE(item.z, o + 8); writeColor(data, 128 + i * 16, item.color); });
  entries[index] = { ...entry, data };
  return { ...documentModel, entries, edited: true };
}
