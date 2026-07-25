import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import type { SaveEntry } from "../models/save-model";
import { cbsCrypt } from "./cbs-crypto";
import { packPs2Tod, ps2DirMode, ps2FileMode, ps2TodFromDate, type Ps2Tod } from "./ps2-dirent";
import { zlibStore } from "./zlib-stream";

export interface CbsWriteInput {
  dirName: string;
  rootMode?: number;
  entries: Array<Pick<SaveEntry, "name" | "nameRaw" | "data" | "attribute" | "mode" | "createdAt" | "modifiedAt">>;
  date?: Date;
}

const cbsHeaderLength = 0x128;
const cbsEntryLength = 0x40;

function defaultDate(input?: Date): Ps2Tod {
  return ps2TodFromDate(input ?? new Date());
}

function entryDate(date: Date | undefined, fallback: Ps2Tod): Ps2Tod {
  return date ? ps2TodFromDate(date) : fallback;
}

function packEntry(input: {
  name: string;
  nameRaw?: Buffer;
  data: Buffer;
  mode: number;
  created: Ps2Tod;
  modified: Ps2Tod;
}): Buffer {
  const output = Buffer.alloc(cbsEntryLength, 0);
  packPs2Tod(input.created).copy(output, 0);
  packPs2Tod(input.modified).copy(output, 8);
  output.writeUInt32LE(input.data.length, 16);
  output.writeUInt32LE(input.mode, 20);
  const nameRaw = input.nameRaw && input.nameRaw.length === 32 ? Buffer.from(input.nameRaw) : writeFixedAscii(input.name, 32);
  nameRaw.copy(output, 32);
  return output;
}

export class CbsWriter {
  write(input: CbsWriteInput): Buffer {
    const timestamp = defaultDate(input.date);
    const dataChunks = [];

    for (const entry of input.entries) {
      const data = Buffer.from(entry.data);
      dataChunks.push(
        packEntry({
          name: entry.name,
          nameRaw: entry.nameRaw,
          data,
          mode: entry.mode ?? entry.attribute ?? ps2FileMode,
          created: entryDate(entry.createdAt, timestamp),
          modified: entryDate(entry.modifiedAt, timestamp),
        }),
        data,
      );
    }

    const decompressed = Buffer.concat(dataChunks);
    const compressed = cbsCrypt(zlibStore(decompressed));
    const header = Buffer.alloc(cbsHeaderLength, 0);
    header.write("CFU", 0, "ascii");
    header.writeUInt32LE(0x1f40, 4);
    header.writeUInt32LE(cbsHeaderLength, 8);
    header.writeUInt32LE(decompressed.length, 12);
    header.writeUInt32LE(cbsHeaderLength + compressed.length, 16);
    writeFixedAscii(input.dirName, 32).copy(header, 20);
    packPs2Tod(timestamp).copy(header, 52);
    packPs2Tod(timestamp).copy(header, 60);
    header.writeUInt32LE(input.rootMode ?? ps2DirMode, 72);

    return Buffer.concat([header, compressed]);
  }
}
