import { Buffer } from "buffer";
import { readNullTerminatedAscii, writeFixedAscii } from "../binary/fixed-string";

export const ps2DirentLength = 512;
export const ps2DirMode = 0x8427;
export const ps2FileMode = 0x8417;

const ps2ModeFile = 0x0010;
const ps2ModeDir = 0x0020;
const ps2ModeExists = 0x8000;

export interface Ps2Tod {
  second: number;
  minute: number;
  hour: number;
  day: number;
  month: number;
  year: number;
}

export interface Ps2Dirent {
  mode: number;
  unknown: number;
  length: number;
  created: Ps2Tod;
  cluster: number;
  parent: number;
  modified: Ps2Tod;
  attr: number;
  nameRaw?: Buffer;
  name: string;
}

export function packPs2Tod(tod: Ps2Tod): Buffer {
  const output = Buffer.alloc(8, 0);
  output.writeUInt8(tod.second, 1);
  output.writeUInt8(tod.minute, 2);
  output.writeUInt8(tod.hour, 3);
  output.writeUInt8(tod.day, 4);
  output.writeUInt8(tod.month, 5);
  output.writeUInt16LE(tod.year, 6);
  return output;
}

export function unpackPs2Tod(input: Buffer): Ps2Tod {
  if (input.length < 8) {
    throw new Error("PS2 ToD read out of bounds");
  }

  return {
    second: input.readUInt8(1),
    minute: input.readUInt8(2),
    hour: input.readUInt8(3),
    day: input.readUInt8(4),
    month: input.readUInt8(5),
    year: input.readUInt16LE(6),
  };
}

export function ps2TodFromDate(date: Date): Ps2Tod {
  return {
    second: date.getUTCSeconds(),
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

export function dateFromPs2Tod(tod: Ps2Tod): Date | undefined {
  if (!tod.year || !tod.month || !tod.day) {
    return undefined;
  }

  return new Date(Date.UTC(tod.year, tod.month - 1, tod.day, tod.hour, tod.minute, tod.second));
}

export function packPs2Dirent(entry: Ps2Dirent): Buffer {
  const output = Buffer.alloc(ps2DirentLength, 0);
  output.writeUInt16LE(entry.mode, 0);
  output.writeUInt16LE(entry.unknown, 2);
  output.writeUInt32LE(entry.length, 4);
  packPs2Tod(entry.created).copy(output, 8);
  output.writeUInt32LE(entry.cluster, 16);
  output.writeUInt32LE(entry.parent, 20);
  packPs2Tod(entry.modified).copy(output, 24);
  output.writeUInt32LE(entry.attr, 32);
  const nameRaw =
    entry.nameRaw && entry.nameRaw.length === 448 ? Buffer.from(entry.nameRaw) : writeFixedAscii(entry.name, 448);
  nameRaw.copy(output, 64);
  return output;
}

export function unpackPs2Dirent(input: Buffer): Ps2Dirent {
  if (input.length < ps2DirentLength) {
    throw new Error("PS2 dirent read out of bounds");
  }

  const nameRaw = input.subarray(64, 512);
  return {
    mode: input.readUInt16LE(0),
    unknown: input.readUInt16LE(2),
    length: input.readUInt32LE(4),
    created: unpackPs2Tod(input.subarray(8, 16)),
    cluster: input.readUInt32LE(16),
    parent: input.readUInt32LE(20),
    modified: unpackPs2Tod(input.subarray(24, 32)),
    attr: input.readUInt32LE(32),
    nameRaw,
    name: readNullTerminatedAscii(nameRaw),
  };
}

export function isPs2FileMode(mode: number): boolean {
  return (mode & (ps2ModeFile | ps2ModeDir | ps2ModeExists)) === (ps2ModeFile | ps2ModeExists);
}

export function isPs2DirMode(mode: number): boolean {
  // Some real PSU archives set both the file and directory bits on the
  // synthetic . and .. entries (0x8497). The directory and exists bits are
  // the authoritative part of the mode for these entries.
  return (mode & (ps2ModeDir | ps2ModeExists)) === (ps2ModeDir | ps2ModeExists);
}

export function byteSwap16(value: number): number {
  return ((value & 0xff) << 8) | ((value >>> 8) & 0xff);
}
