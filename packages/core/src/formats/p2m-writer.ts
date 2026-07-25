import { Buffer } from "buffer";
import { writeFixedAscii } from "../binary/fixed-string";
import { MdWriter, type MdWriteInput } from "./md-writer";
import { p2mMagic, p2mPayloadMagic } from "./p2m-reader";

export interface P2mWriteInput extends MdWriteInput { displayName?: string }

export class P2mWriter {
  write(input: P2mWriteInput): Buffer {
    const header = Buffer.alloc(72, 0);
    p2mMagic.copy(header, 0);
    writeFixedAscii(input.displayName || input.dirName, 56).copy(header, 8);
    p2mPayloadMagic.copy(header, 64);
    const output = Buffer.concat([header, new MdWriter().write(input)]);
    output.writeUInt32LE(output.length - 12, 4);
    return output;
  }
}
