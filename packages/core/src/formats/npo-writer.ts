import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import { ps2DirMode, ps2FileMode } from "./ps2-dirent";
import { npoMagic } from "./npo-reader";
import type { SaveEntry } from "../models/save-model";

export interface NpoWriteInput {
  rootMode?: number;
  entries: Array<Pick<SaveEntry, "name" | "data" | "attribute" | "mode">>;
}

export class NpoWriter {
  write(input: NpoWriteInput): Buffer {
    const header = Buffer.alloc(24, 0);
    npoMagic.copy(header, 0);
    header.writeUInt32LE(input.entries.length + 1, 8);

    const records: Buffer[] = [header];
    let offset = header.length;
    let iconSysDataOffset = 0;
    let iconDataOffset = 0;
    const iconSys = input.entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
    const iconName = iconSys && iconSys.data.length >= 324
      ? iconSys.data.subarray(260, 324).toString("ascii").split("\0")[0]
      : "";
    for (const entry of input.entries) {
      const record = Buffer.alloc(56, 0);
      writeFixedAscii(entry.name, 48).copy(record, 0);
      record.writeUInt32LE(entry.data.length, 48);
      record.writeUInt32LE(entry.mode ?? entry.attribute ?? ps2FileMode, 52);
      records.push(record, entry.data);
      const dataOffset = offset + record.length;
      if (entry.name.toLowerCase() === "icon.sys") iconSysDataOffset = dataOffset;
      if (iconName && entry.name === iconName) iconDataOffset = dataOffset;
      offset = dataOffset + entry.data.length;
    }

    header.writeUInt32LE(iconSysDataOffset, 12);
    header.writeUInt32LE(iconDataOffset, 16);

    const directory = Buffer.alloc(56, 0);
    directory.writeUInt32LE(input.entries.length + 2, 48);
    directory.writeUInt32LE(input.rootMode ?? ps2DirMode, 52);
    records.push(directory);
    return Buffer.concat(records);
  }
}
