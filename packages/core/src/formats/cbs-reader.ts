import type { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import type { SaveEntry } from "../models/save-model";
import { cbsCrypt } from "./cbs-crypto";
import type { CbsHeader, ParsedCbsSave } from "./cbs-types";
import { dateFromPs2Tod, ps2DirMode, unpackPs2Tod } from "./ps2-dirent";
import { zlibInflate } from "./zlib-stream";

const cbsHeaderLength = 0x128;
const cbsEntryLength = 0x40;

export function isCbsBuffer(input: Buffer): boolean {
  return input.length > cbsHeaderLength && input[0] === 0x43 && input[1] === 0x46 && input[2] === 0x55 && input[3] === 0x00;
}

function readHeader(input: Buffer): CbsHeader {
  const nameRaw = input.subarray(20, 52);
  return {
    magic: input.subarray(0, 3).toString("ascii"),
    unknown1: input.readUInt32LE(4),
    dataOffset: input.readUInt32LE(8),
    decompressedSize: input.readUInt32LE(12),
    compressedSize: input.readUInt32LE(16),
    nameRaw,
    name: readNullTerminatedAscii(nameRaw),
    created: dateFromPs2Tod(unpackPs2Tod(input.subarray(52, 60))),
    modified: dateFromPs2Tod(unpackPs2Tod(input.subarray(60, 68))),
    unknown2: input.readUInt32LE(68),
    mode: input.readUInt32LE(72),
    title: readNullTerminatedAscii(input.subarray(92, 164)),
    description: readNullTerminatedAscii(input.subarray(164, 296)),
  };
}

export class CbsReader {
  async read(input: Buffer): Promise<ParsedCbsSave> {
    if (!isCbsBuffer(input)) {
      throw new Error("Not a valid CBS save");
    }

    const header = readHeader(input);
    if (!header.name || header.dataOffset !== cbsHeaderLength || header.decompressedSize <= 0 || header.compressedSize <= 0) {
      throw new Error("Not a valid CBS save");
    }

    const encrypted = input.subarray(header.dataOffset);
    const decompressed = await zlibInflate(cbsCrypt(encrypted));
    if (decompressed.length !== header.decompressedSize) {
      throw new Error(`CBS decompressed size mismatch: header=${header.decompressedSize} actual=${decompressed.length}`);
    }

    const entries: SaveEntry[] = [];
    const fileEntries = [];
    let offset = 0;
    while (offset < header.decompressedSize) {
      if (offset + cbsEntryLength > decompressed.length) {
        throw new Error(`CBS entry read out of bounds at ${offset}`);
      }

      const entryStart = offset;
      const createdTod = unpackPs2Tod(decompressed.subarray(offset, offset + 8));
      const modifiedTod = unpackPs2Tod(decompressed.subarray(offset + 8, offset + 16));
      const length = decompressed.readUInt32LE(offset + 16);
      const mode = decompressed.readUInt32LE(offset + 20);
      const nameRaw = decompressed.subarray(offset + 32, offset + 64);
      const name = readNullTerminatedAscii(nameRaw);
      offset += cbsEntryLength;

      if (!name) {
        throw new Error("CBS entry has no name");
      }
      if (offset + length > decompressed.length || offset + length > header.decompressedSize) {
        throw new Error(`CBS entry data out of bounds for ${name}: start=${offset} size=${length}`);
      }

      const createdAt = dateFromPs2Tod(createdTod);
      const modifiedAt = dateFromPs2Tod(modifiedTod);
      const data = decompressed.subarray(offset, offset + length);
      entries.push({
        name,
        nameRaw,
        size: length,
        data,
        mode,
        attribute: mode,
        createdAt,
        modifiedAt,
        positionInFile: offset,
      });
      fileEntries.push({
        mode,
        unknown: 0,
        length,
        created: createdTod,
        cluster: 0,
        parent: 0,
        modified: modifiedTod,
        attr: 0,
        nameRaw,
        name,
      });
      offset += length;

      if (offset === entryStart) {
        throw new Error("CBS parser made no progress");
      }
    }

    return {
      type: "ps2",
      sourceFormat: "cbs",
      displayName: header.name,
      dirName: header.name,
      header,
      directoryEntry: {
        mode: header.mode || ps2DirMode,
        unknown: 0,
        length: entries.length,
        created: unpackPs2Tod(input.subarray(52, 60)),
        cluster: 0,
        parent: 0,
        modified: unpackPs2Tod(input.subarray(60, 68)),
        attr: 0,
        nameRaw: header.nameRaw,
        name: header.name,
      },
      fileEntries,
      entries,
      rawInput: input,
    };
  }
}
