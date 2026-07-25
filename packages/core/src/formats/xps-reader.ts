import { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import {
  byteSwap16,
  dateFromPs2Tod,
  isPs2DirMode,
  isPs2FileMode,
  unpackPs2Tod,
  type Ps2Dirent,
} from "./ps2-dirent";
import type { ParsedXpsSave, XpsHeader, XpsSourceFormat } from "./xps-types";

export const sharkportMagic = Buffer.concat([Buffer.from([0x0d, 0, 0, 0]), Buffer.from("SharkPortSave", "ascii")]);

export function sharkportChecksum(input: Buffer): number {
  let checksum = 0;

  for (const value of input) {
    checksum = (checksum + ((value << (checksum % 24)) >>> 0)) >>> 0;
  }

  return checksum;
}

export function isXpsBuffer(input: Buffer): boolean {
  return input.length >= sharkportMagic.length && input.subarray(0, sharkportMagic.length).equals(sharkportMagic);
}

function readUInt32(input: Buffer, offset: number): number {
  if (offset + 4 > input.length) {
    throw new Error(`XPS read out of bounds at ${offset}`);
  }

  return input.readUInt32LE(offset);
}

function readLengthPrefixedString(input: Buffer, offset: number): { value: string; offset: number } {
  const length = readUInt32(input, offset);
  const start = offset + 4;
  const end = start + length;

  if (end > input.length) {
    throw new Error(`XPS read out of bounds at ${start}`);
  }

  return {
    value: input.subarray(start, end).toString("ascii"),
    offset: end,
  };
}

function readDescriptor(input: Buffer, offset: number): { entry: Ps2Dirent; offset: number; legacyLayout: boolean } {
  if (offset + 98 > input.length) {
    throw new Error(`XPS read out of bounds at ${offset}`);
  }

  const legacyLayout = input[offset] === 0 && input[offset + 1] !== 0;
  const descriptorLength = legacyLayout ? input.readUInt16BE(offset) : input.readUInt16LE(offset);
  if (descriptorLength < 98 || offset + descriptorLength > input.length) {
    throw new Error(`Invalid XPS descriptor length at ${offset}: ${descriptorLength}`);
  }

  const shift = legacyLayout ? 1 : 0;
  const nameRaw = input.subarray(offset + 2 + shift, offset + 66 + shift);
  const mode = byteSwap16(input.readUInt16LE(offset + 78 + shift));
  const entry: Ps2Dirent = {
    mode,
    unknown: 0,
    length: input.readUInt32LE(offset + 66 + shift),
    created: unpackPs2Tod(input.subarray(offset + 82 + shift, offset + 90 + shift)),
    cluster: input.readUInt32LE(offset + 70 + shift),
    parent: 0,
    modified: unpackPs2Tod(input.subarray(offset + 90 + shift, offset + 98 + shift)),
    attr: 0,
    nameRaw,
    name: readNullTerminatedAscii(nameRaw),
  };

  return {
    entry,
    offset: offset + descriptorLength,
    legacyLayout,
  };
}

export class XpsReader {
  read(input: Buffer, sourceFormat: XpsSourceFormat = "xps"): ParsedXpsSave {
    if (!isXpsBuffer(input)) {
      throw new Error("Not a SharkPort/X-Port save file");
    }
    if (input.length < sharkportMagic.length + 4 + 4) {
      throw new Error("XPS read out of bounds at 0");
    }

    let offset = sharkportMagic.length;
    const saveType = readUInt32(input, offset);
    offset += 4;

    const fileName = readLengthPrefixedString(input, offset);
    offset = fileName.offset;
    const dateStamp = readLengthPrefixedString(input, offset);
    offset = dateStamp.offset;
    const comment = readLengthPrefixedString(input, offset);
    offset = comment.offset;

    const descriptorBytes = readUInt32(input, offset);
    offset += 4;
    // Early X-Port archives include a single zero marker before an otherwise
    // standard 250-byte descriptor stream.
    const legacyContainer = input[offset] === 0 && input.readUInt16LE(offset + 1) >= 98;
    if (legacyContainer) offset += 1;
    const descriptorStart = offset;
    const descriptorEnd = descriptorStart + descriptorBytes;
    if (descriptorEnd + 4 > input.length) {
      throw new Error(`XPS read out of bounds at ${descriptorStart}`);
    }

    const directory = readDescriptor(input, offset);
    offset = directory.offset;
    const directoryEntry = directory.entry;
    const extendedFileCount = input.readUInt32LE(descriptorStart + 102);
    const fileCount = legacyContainer
      ? input.readUInt32LE(descriptorStart + 102)
      : directory.legacyLayout
        ? input.readUInt32LE(descriptorStart + 103)
        : extendedFileCount > 0 && extendedFileCount < 10_000
          ? extendedFileCount
          : directoryEntry.length - 2;

    if (!isPs2DirMode(directoryEntry.mode) || fileCount < 0) {
      throw new Error("Bad values in XPS directory entry");
    }

    const fileEntries = [];
    const entries = [];

    for (let index = 0; index < fileCount; index += 1) {
      // Original X-Port files may place 0xff fill bytes between a payload and
      // the next big-endian descriptor header.
      if (legacyContainer || directory.legacyLayout || extendedFileCount > 0) {
        while (offset < descriptorEnd && input[offset] === 0xff) offset += 1;
      }
      const descriptor = readDescriptor(input, offset);
      offset = descriptor.offset;
      const fileEntry = descriptor.entry;

      if (!isPs2FileMode(fileEntry.mode)) {
        throw new Error(`XPS entry is not a file: ${fileEntry.name || index}`);
      }

      const dataEnd = offset + fileEntry.length;
      if (dataEnd > descriptorEnd) {
        throw new Error(`XPS read out of bounds at ${offset}`);
      }

      const data = input.subarray(offset, dataEnd);
      fileEntries.push(fileEntry);
      entries.push({
        name: fileEntry.name,
        nameRaw: fileEntry.nameRaw,
        size: fileEntry.length,
        data,
        attribute: fileEntry.mode,
        mode: fileEntry.mode,
        createdAt: dateFromPs2Tod(fileEntry.created),
        modifiedAt: dateFromPs2Tod(fileEntry.modified),
      });
      offset = dataEnd;
    }

    if (offset !== descriptorEnd) {
      throw new Error(`XPS descriptor size mismatch: header=${descriptorBytes} actual=${offset - descriptorStart} entries=${entries.length}/${fileCount}`);
    }

    const checksum = input.readUInt32LE(descriptorEnd);
    const computedChecksum = sharkportChecksum(input.subarray(0, descriptorEnd));
    const header: XpsHeader = {
      magic: input.subarray(0, sharkportMagic.length),
      saveType,
      fileName: fileName.value,
      dateStamp: dateStamp.value,
      comment: comment.value,
      descriptorBytes,
    };

    return {
      type: "ps2",
      sourceFormat,
      displayName: directoryEntry.name,
      dirName: directoryEntry.name,
      header,
      directoryEntry,
      fileEntries,
      entries,
      checksum,
      computedChecksum,
      checksumValid: checksum === computedChecksum,
      rawInput: input,
    };
  }
}
