import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import { byteSwap16, packPs2Tod, ps2DirMode, ps2FileMode, ps2TodFromDate, type Ps2Tod } from "./ps2-dirent";
import type { SaveEntry } from "../models/save-model";

export interface XpoWriteInput {
  dirName: string;
  rootMode?: number;
  displayName?: string;
  description?: string;
  entries: Array<Pick<SaveEntry, "name" | "data" | "attribute" | "mode" | "createdAt" | "modifiedAt">>;
  date?: Date;
}

function descriptor(input: { name: string; size: number; mode: number; created: Ps2Tod; modified: Ps2Tod; directory?: boolean }): Buffer {
  const output = Buffer.alloc(250, 0);
  output.writeUInt16LE(input.directory ? 0 : 250, 0);
  writeFixedAscii(input.name, 64).copy(output, 2);
  output.writeUInt32LE(input.size, 66);
  output.writeUInt16LE(byteSwap16(input.mode), 78);
  packPs2Tod(input.created).copy(output, 82);
  packPs2Tod(input.modified).copy(output, 90);
  writeFixedAscii(input.name, 64).copy(output, 114);
  writeFixedAscii(input.name, 64).copy(output, 178);
  return output;
}

export class XpoWriter {
  write(input: XpoWriteInput): Buffer {
    const fallback = ps2TodFromDate(input.date ?? new Date());
    const header = Buffer.alloc(52, 0);
    Buffer.from([1, 0, 0, 0, 0, 1, 1, 0x2a]).copy(header, 0);
    header.writeUInt32LE(4, 12);
    writeFixedAscii(input.displayName || input.dirName, 16).copy(header, 18);
    writeFixedAscii(input.description || "", 16).copy(header, 35);

    const chunks: Buffer[] = [header, descriptor({
      name: input.dirName,
      size: input.entries.length + 2,
      mode: input.rootMode ?? ps2DirMode,
      created: fallback,
      modified: fallback,
      directory: true,
    })];
    for (const entry of input.entries) {
      chunks.push(descriptor({
        name: entry.name,
        size: entry.data.length,
        mode: entry.mode ?? entry.attribute ?? ps2FileMode,
        created: entry.createdAt ? ps2TodFromDate(entry.createdAt) : fallback,
        modified: entry.modifiedAt ? ps2TodFromDate(entry.modifiedAt) : fallback,
      }), entry.data);
    }
    const output = Buffer.concat(chunks);
    output.writeUInt32LE(output.length - 4, 8);
    return output;
  }
}
