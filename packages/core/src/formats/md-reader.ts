import type { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import { dateFromPs2Tod, isPs2DirMode, isPs2FileMode, unpackPs2Tod } from "./ps2-dirent";
import type { ParsedMdSave } from "./md-types";

export const mdRecordLength = 128;

function record(input: Buffer, offset: number) {
  if (offset + mdRecordLength > input.length) throw new Error(`MD record read out of bounds at ${offset}`);
  const nameRaw = input.subarray(offset + 40, offset + 72);
  return {
    createdAt: dateFromPs2Tod(unpackPs2Tod(input.subarray(offset + 8, offset + 16))),
    modifiedAt: dateFromPs2Tod(unpackPs2Tod(input.subarray(offset + 16, offset + 24))),
    mode: input.readUInt32LE(offset + 28),
    nameRaw,
    name: readNullTerminatedAscii(nameRaw),
    position: input.readUInt32LE(offset + 72),
    size: input.readUInt32LE(offset + 76),
  };
}

export class MdReader {
  read(input: Buffer): ParsedMdSave {
    if (input.length < mdRecordLength * 2) throw new Error("Not a SharkPort MD save file");
    const recordCount = input.readUInt32LE(0);
    const payloadBytes = input.readUInt32LE(4);
    if (recordCount < 2 || recordCount * mdRecordLength > input.length) throw new Error(`Invalid MD record count: ${recordCount}`);
    const root = record(input, 0);
    if (!isPs2DirMode(root.mode) || !root.name) throw new Error("Invalid MD root record");

    const entries = [];
    let totalBytes = 0;
    for (let index = 1; index < recordCount; index += 1) {
      const item = record(input, index * mdRecordLength);
      if (!isPs2FileMode(item.mode) || !item.name) throw new Error(`Invalid MD file record: ${index}`);
      const dataStart = item.position;
      const dataEnd = dataStart + item.size;
      if (dataEnd > input.length) throw new Error(`MD file read out of bounds at ${dataStart}`);
      entries.push({
        name: item.name, nameRaw: item.nameRaw, size: item.size, data: input.subarray(dataStart, dataEnd),
        attribute: item.mode, mode: item.mode, createdAt: item.createdAt, modifiedAt: item.modifiedAt,
        positionInFile: dataStart,
      });
      totalBytes += item.size;
    }
    if (totalBytes !== payloadBytes) throw new Error(`MD payload size mismatch: header=${payloadBytes} actual=${totalBytes}`);
    return { type: "ps2", sourceFormat: "md", displayName: root.name, dirName: root.name, rootMode: root.mode, entries, rawInput: input };
  }
}
