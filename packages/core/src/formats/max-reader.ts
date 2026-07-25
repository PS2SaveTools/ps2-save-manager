import { Buffer } from "buffer";
import { BinaryReader } from "../binary/binary-reader";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import { decodeLzari } from "../compression/lzari";
import { crc32 } from "../util/crc32";
import type { MaxEntry, MaxHeader, ParsedMaxSave } from "./max-types";

function withZeroedChecksum(input: Buffer): Buffer {
  const clone = Buffer.from(input);
  clone.writeUInt32LE(0, 12);
  return clone;
}

export class MaxReader {
  read(input: Buffer): ParsedMaxSave {
    const reader = new BinaryReader(input);
    const header = this.readHeader(reader);

    if (header.magic !== "Ps2PowerSave") {
      throw new Error(`Invalid MAX magic: ${header.magic}`);
    }

    const actualCompressedSize = input.length - 92;
    const validCompressedSize =
      actualCompressedSize === header.compressedSize ||
      actualCompressedSize === header.compressedSize - 4 ||
      // A small number of legacy MAX producers copied the original size into
      // both size fields. The checksum and decompressor still validate the
      // actual payload, so accept that identifiable header variant.
      header.compressedSize === header.origSize;

    if (!validCompressedSize) {
      throw new Error(`MAX size mismatch: header=${header.compressedSize} actual=${actualCompressedSize}`);
    }

    const computedChecksum = crc32(withZeroedChecksum(input));
    if (computedChecksum !== header.checksum) {
      throw new Error(`Invalid MAX checksum: expected ${header.checksum} computed ${computedChecksum}`);
    }

    const compressedPayload = input.subarray(92);
    const decompressedClump = decodeLzari(compressedPayload, header.origSize);
    const entries = this.extractEntries(decompressedClump);

    if (entries.length !== header.numFiles) {
      throw new Error(`MAX file count mismatch: header=${header.numFiles} actual=${entries.length}`);
    }

    return {
      sourceFormat: "max",
      displayName: header.dirName,
      header,
      compressedPayload,
      decompressedClump,
      entries,
      rawInput: input,
    };
  }

  private readHeader(reader: BinaryReader): MaxHeader {
    const magic = reader.readBytes(12).toString("ascii");
    const checksum = reader.readInt32LE() >>> 0;
    const dirNameRaw = reader.readBytes(32);
    const iconSysNameRaw = reader.readBytes(32);
    const compressedSize = reader.readInt32LE();
    const numFiles = reader.readInt32LE();
    const origSize = reader.readInt32LE();

    return {
      magic,
      checksum,
      dirNameRaw,
      dirName: readNullTerminatedAscii(dirNameRaw),
      iconSysNameRaw,
      iconSysName: readNullTerminatedAscii(iconSysNameRaw),
      compressedSize,
      numFiles,
      origSize,
    };
  }

  private extractEntries(clump: Buffer): MaxEntry[] {
    const entries: MaxEntry[] = [];
    let offset = 0;

    while (offset < clump.length) {
      if (offset + 36 > clump.length) {
        throw new Error(`Invalid MAX clump entry header at ${offset}`);
      }

      const size = clump.readInt32LE(offset);
      const nameRaw = clump.subarray(offset + 4, offset + 36);
      const name = readNullTerminatedAscii(nameRaw);
      const dataStart = offset + 36;
      const dataEnd = dataStart + size;

      if (size < 0 || dataEnd > clump.length) {
        throw new Error(`Invalid MAX clump entry size at ${offset}: ${size}`);
      }

      const data = clump.subarray(dataStart, dataEnd);

      entries.push({
        nameRaw,
        name,
        size,
        data,
      });

      const nextOffset = Math.ceil((dataEnd + 8) / 16) * 16 - 8;
      if (nextOffset <= offset || nextOffset > clump.length) {
        throw new Error(`Invalid MAX clump padding after ${name || "<unnamed>"}`);
      }

      offset = nextOffset;
    }

    return entries;
  }
}
