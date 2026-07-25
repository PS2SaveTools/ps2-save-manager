import type { Buffer } from "buffer";
import { BinaryReader } from "../binary/binary-reader";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import type { McsHeader, ParsedMcsSave } from "./mcs-types";

function xorChecksum(buffer: Buffer): number {
  let result = 0;

  for (const value of buffer) {
    result ^= value;
  }

  return result;
}

export class McsReader {
  read(input: Buffer): ParsedMcsSave {
    const reader = new BinaryReader(input);
    const header = this.readHeader(reader);
    const saveData = input.subarray(0x80);

    if (header.magic !== 81) {
      throw new Error(`Invalid MCS magic: ${header.magic}`);
    }

    if (header.dataSize !== saveData.length) {
      throw new Error(`MCS data size mismatch: header=${header.dataSize} actual=${saveData.length}`);
    }

    const computedChecksum = xorChecksum(input.subarray(0, 0x7f));
    if (computedChecksum !== header.checksum) {
      throw new Error(`Invalid MCS checksum: expected ${header.checksum} computed ${computedChecksum}`);
    }

    return {
      sourceFormat: "mcs",
      displayName: header.prodCode,
      prodCode: header.prodCode,
      header,
      saveData,
      rawInput: input,
    };
  }

  private readHeader(reader: BinaryReader): McsHeader {
    const magic = reader.readInt32LE();
    const dataSize = reader.readInt32LE();
    const positionInCard = reader.readUInt16LE();
    const prodCodeRaw = reader.readBytes(20);
    const filler = reader.readBytes(97);
    const checksum = reader.readUInt8();

    return {
      magic,
      dataSize,
      positionInCard,
      prodCodeRaw,
      prodCode: readNullTerminatedAscii(prodCodeRaw),
      filler,
      checksum,
    };
  }
}
