import { Buffer } from "buffer";
import { BinaryWriter } from "../binary/binary-writer";
import type { ParsedMcsSave } from "./mcs-types";

export interface McsWriteInput {
  prodCode: string;
  saveData: Buffer;
  positionInCard?: number;
}

function xorChecksum(buffer: Buffer): number {
  let result = 0;

  for (const value of buffer) {
    result ^= value;
  }

  return result;
}

function toProdCodeBuffer(prodCode: string): Buffer {
  const buffer = Buffer.alloc(20, 0);
  Buffer.from(prodCode, "ascii").copy(buffer, 0, 0, Math.min(prodCode.length, 20));
  return buffer;
}

export class McsWriter {
  write(input: McsWriteInput): Buffer {
    const writer = new BinaryWriter();
    const prodCodeRaw = toProdCodeBuffer(input.prodCode);
    const filler = Buffer.alloc(97, 0);

    writer
      .writeInt32LE(81)
      .writeInt32LE(input.saveData.length)
      .writeUInt16LE(input.positionInCard ?? 0xffff)
      .writeBytes(prodCodeRaw)
      .writeBytes(filler);

    const headerWithoutChecksum = writer.toBuffer();
    const checksum = xorChecksum(headerWithoutChecksum.subarray(0, 0x7f));

    return Buffer.concat([headerWithoutChecksum, Buffer.from([checksum]), Buffer.from(input.saveData)]);
  }

  writeFromParsed(save: ParsedMcsSave): Buffer {
    return this.write({
      prodCode: save.prodCode,
      saveData: save.saveData,
      positionInCard: save.header.positionInCard,
    });
  }
}
