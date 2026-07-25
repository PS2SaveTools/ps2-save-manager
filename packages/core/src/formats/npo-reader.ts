import { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import type { ParsedNpoSave } from "./npo-types";

export const npoMagic = Buffer.from([0x6e, 0x50, 0x6f, 0x72, 0x74, 0, 0, 0]);
const headerLength = 24;
const recordLength = 56;

export function isNpoBuffer(input: Buffer): boolean {
  return input.length >= headerLength + recordLength && input.subarray(0, 8).equals(npoMagic);
}

export class NpoReader {
  read(input: Buffer, dirName: string): ParsedNpoSave {
    if (!isNpoBuffer(input)) throw new Error("Not an nPort save file");
    const recordCount = input.readUInt32LE(8);
    const iconSysDataOffset = input.readUInt32LE(12);
    const iconDataOffset = input.readUInt32LE(16);
    if (recordCount < 1) throw new Error(`Invalid NPO record count: ${recordCount}`);

    const entries = [];
    let offset = headerLength;
    for (let index = 0; index < recordCount - 1; index += 1) {
      if (offset + recordLength > input.length) throw new Error(`NPO record read out of bounds at ${offset}`);
      const nameRaw = input.subarray(offset, offset + 48);
      const name = readNullTerminatedAscii(nameRaw);
      const size = input.readUInt32LE(offset + 48);
      const mode = input.readUInt32LE(offset + 52);
      const dataStart = offset + recordLength;
      const dataEnd = dataStart + size;
      if (!name || dataEnd > input.length) throw new Error(`Invalid NPO file record at ${offset}`);
      entries.push({
        name,
        nameRaw,
        size,
        data: input.subarray(dataStart, dataEnd),
        attribute: mode || undefined,
        mode: mode || undefined,
      });
      offset = dataEnd;
    }

    if (offset + recordLength !== input.length) throw new Error(`NPO directory marker mismatch at ${offset}`);
    const directoryCount = input.readUInt32LE(offset + 48);
    const rootMode = input.readUInt32LE(offset + 52) || 0x84a7;
    if (directoryCount !== 0 && directoryCount !== recordCount + 1) {
      throw new Error(`NPO directory count mismatch: expected ${recordCount + 1} actual ${directoryCount}`);
    }

    return {
      type: "ps2",
      sourceFormat: "npo",
      displayName: dirName,
      dirName,
      rootMode,
      header: { recordCount, iconSysDataOffset, iconDataOffset },
      entries,
      rawInput: input,
    };
  }
}
