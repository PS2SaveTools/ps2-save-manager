import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import type { SaveEntry } from "../models/save-model";
import {
  byteSwap16,
  ps2DirMode,
  ps2FileMode,
  ps2TodFromDate,
  type Ps2Tod,
} from "./ps2-dirent";
import { sharkportChecksum, sharkportMagic } from "./xps-reader";
import type { ParsedXpsSave, XpsSourceFormat } from "./xps-types";

export interface XpsWriteInput {
  dirName: string;
  rootMode?: number;
  entries: Array<Pick<SaveEntry, "name" | "data" | "attribute" | "mode" | "createdAt" | "modifiedAt">>;
  date?: Date;
  sourceFormat: XpsSourceFormat;
}

function writeUInt32(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

function writeLengthPrefixedString(value: string): Buffer {
  const data = Buffer.from(value, "ascii");
  return Buffer.concat([writeUInt32(data.length), data]);
}

function packTod(tod: Ps2Tod): Buffer {
  const output = Buffer.alloc(8, 0);
  output.writeUInt8(tod.second, 1);
  output.writeUInt8(tod.minute, 2);
  output.writeUInt8(tod.hour, 3);
  output.writeUInt8(tod.day, 4);
  output.writeUInt8(tod.month, 5);
  output.writeUInt16LE(tod.year, 6);
  return output;
}

function entryDate(date: Date | undefined, fallback: Ps2Tod): Ps2Tod {
  return date ? ps2TodFromDate(date) : fallback;
}

function descriptor(input: {
  name: string;
  length: number;
  mode: number;
  created: Ps2Tod;
  modified: Ps2Tod;
}): Buffer {
  const output = Buffer.alloc(250, 0);
  output.writeUInt16LE(250, 0);
  writeFixedAscii(input.name, 64).copy(output, 2);
  output.writeUInt32LE(input.length, 66);
  output.writeUInt32LE(0, 70);
  output.writeUInt32LE(0, 74);
  output.writeUInt16LE(byteSwap16(input.mode), 78);
  packTod(input.created).copy(output, 82);
  packTod(input.modified).copy(output, 90);
  writeFixedAscii(input.name, 64).copy(output, 114);
  writeFixedAscii(input.name, 64).copy(output, 178);
  return output;
}

export class XpsWriter {
  write(input: XpsWriteInput): Buffer {
    const timestamp = ps2TodFromDate(input.date ?? new Date());
    const header = Buffer.concat([
      sharkportMagic,
      writeUInt32(0),
      writeLengthPrefixedString(input.dirName),
      writeLengthPrefixedString((input.date ?? new Date()).toISOString()),
      writeLengthPrefixedString(""),
    ]);

    const bodyChunks = [
      descriptor({
        name: input.dirName,
        length: input.entries.length + 2,
        mode: input.rootMode ?? ps2DirMode,
        created: timestamp,
        modified: timestamp,
      }),
    ];

    for (const entry of input.entries) {
      const mode = entry.mode ?? entry.attribute ?? ps2FileMode;
      bodyChunks.push(
        descriptor({
          name: entry.name,
          length: entry.data.length,
          mode,
          created: entryDate(entry.createdAt, timestamp),
          modified: entryDate(entry.modifiedAt, timestamp),
        }),
        entry.data,
      );
    }

    const body = Buffer.concat(bodyChunks);
    const withoutChecksum = Buffer.concat([header, writeUInt32(body.length), body]);
    const checksum = writeUInt32(sharkportChecksum(withoutChecksum));

    return Buffer.concat([withoutChecksum, checksum]);
  }

  writeFromParsed(save: ParsedXpsSave): Buffer {
    return this.write({
      dirName: save.dirName,
      entries: save.entries,
      sourceFormat: save.sourceFormat,
    });
  }
}
