import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import { packPs2Tod, ps2DirMode, ps2FileMode, ps2TodFromDate, type Ps2Tod } from "./ps2-dirent";
import { mdRecordLength } from "./md-reader";
import type { SaveEntry } from "../models/save-model";

export interface MdWriteInput {
  dirName: string;
  rootMode?: number;
  entries: Array<Pick<SaveEntry, "name" | "data" | "attribute" | "mode" | "createdAt" | "modifiedAt">>;
  date?: Date;
}

function writeRecord(input: { name: string; mode: number; created: Ps2Tod; modified: Ps2Tod; position?: number; size?: number }): Buffer {
  const output = Buffer.alloc(mdRecordLength, 0);
  packPs2Tod(input.created).copy(output, 8);
  packPs2Tod(input.modified).copy(output, 16);
  output.writeUInt32LE(input.mode, 28);
  writeFixedAscii(input.name, 32).copy(output, 40);
  if (input.position !== undefined) output.writeUInt32LE(input.position, 72);
  if (input.size !== undefined) output.writeUInt32LE(input.size, 76);
  return output;
}

export class MdWriter {
  write(input: MdWriteInput): Buffer {
    const fallback = ps2TodFromDate(input.date ?? new Date());
    const recordCount = input.entries.length + 1;
    const payloadBytes = input.entries.reduce((sum, entry) => sum + entry.data.length, 0);
    const root = writeRecord({ name: input.dirName, mode: input.rootMode ?? ps2DirMode, created: fallback, modified: fallback });
    root.writeUInt32LE(recordCount, 0);
    root.writeUInt32LE(payloadBytes, 4);
    root.fill(0xff, 72, 80);
    const records = [root];
    let dataOffset = recordCount * mdRecordLength + 8;
    for (const entry of input.entries) {
      records.push(writeRecord({
        name: entry.name,
        mode: entry.mode ?? entry.attribute ?? ps2FileMode,
        created: entry.createdAt ? ps2TodFromDate(entry.createdAt) : fallback,
        modified: entry.modifiedAt ? ps2TodFromDate(entry.modifiedAt) : fallback,
        position: dataOffset,
        size: entry.data.length,
      }));
      dataOffset += entry.data.length;
    }
    return Buffer.concat([...records, Buffer.alloc(8, 0), ...input.entries.map((entry) => entry.data), Buffer.alloc(4, 0)]);
  }
}
