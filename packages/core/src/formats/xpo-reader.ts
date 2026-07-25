import { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import { byteSwap16, dateFromPs2Tod, isPs2DirMode, isPs2FileMode, unpackPs2Tod } from "./ps2-dirent";
import type { ParsedXpoSave, XpoSourceFormat } from "./xpo-types";

const headerLength = 52;
const descriptorLength = 250;
const signature = Buffer.from([1, 0, 0, 0, 0, 1, 1, 0x2a]);

export function isXpoBuffer(input: Buffer): boolean {
  return input.length >= headerLength + descriptorLength && input.subarray(0, 8).equals(signature);
}

function readDescriptor(input: Buffer, offset: number) {
  if (offset + descriptorLength > input.length) throw new Error(`XPO descriptor read out of bounds at ${offset}`);
  const length = input.readUInt16LE(offset);
  if (length !== 0 && length !== descriptorLength) throw new Error(`Invalid XPO descriptor length at ${offset}: ${length}`);
  const nameRaw = input.subarray(offset + 2, offset + 66);
  const mode = byteSwap16(input.readUInt16LE(offset + 78));
  return {
    nameRaw,
    name: readNullTerminatedAscii(nameRaw),
    size: input.readUInt32LE(offset + 66),
    mode,
    createdAt: dateFromPs2Tod(unpackPs2Tod(input.subarray(offset + 82, offset + 90))),
    modifiedAt: dateFromPs2Tod(unpackPs2Tod(input.subarray(offset + 90, offset + 98))),
  };
}

export class XpoReader {
  read(input: Buffer, sourceFormat: XpoSourceFormat = "xpo"): ParsedXpoSave {
    if (!isXpoBuffer(input)) throw new Error("Not an X-Port v1 save file");
    const declaredSize = input.readUInt32LE(8);
    if (declaredSize !== input.length - 4) throw new Error(`XPO size mismatch: header=${declaredSize} actual=${input.length - 4}`);
    if (input.readUInt32LE(12) !== 4) throw new Error("Invalid XPO header version");

    const gameName = readNullTerminatedAscii(input.subarray(18, 34));
    const description = readNullTerminatedAscii(input.subarray(35, 51));
    const directory = readDescriptor(input, headerLength);
    if (!isPs2DirMode(directory.mode) || directory.size < 2) throw new Error("Invalid XPO directory descriptor");
    const fileCount = directory.size - 2;
    let offset = headerLength + descriptorLength;
    const entries = [];
    for (let index = 0; index < fileCount; index += 1) {
      const descriptor = readDescriptor(input, offset);
      if (!isPs2FileMode(descriptor.mode)) throw new Error(`XPO entry is not a file: ${descriptor.name || index}`);
      offset += descriptorLength;
      const dataEnd = offset + descriptor.size;
      if (!descriptor.name || dataEnd > input.length) throw new Error(`XPO file read out of bounds at ${offset}`);
      entries.push({
        name: descriptor.name,
        nameRaw: descriptor.nameRaw,
        size: descriptor.size,
        data: input.subarray(offset, dataEnd),
        attribute: descriptor.mode,
        mode: descriptor.mode,
        createdAt: descriptor.createdAt,
        modifiedAt: descriptor.modifiedAt,
      });
      offset = dataEnd;
    }
    if (offset !== input.length) throw new Error(`XPO trailing data at ${offset}`);

    return {
      type: "ps2",
      sourceFormat,
      displayName: gameName || directory.name,
      dirName: directory.name,
      rootMode: directory.mode,
      header: { fileSize: declaredSize, gameName, description },
      entries,
      rawInput: input,
    };
  }
}
