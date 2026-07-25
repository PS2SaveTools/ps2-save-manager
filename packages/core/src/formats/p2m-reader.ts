import { Buffer } from "buffer";
import { readNullTerminatedAscii } from "../binary/fixed-string";
import { MdReader } from "./md-reader";
import type { ParsedP2mSave } from "./p2m-types";

export const p2mMagic = Buffer.from("P2MS", "ascii");
export const p2mPayloadMagic = Buffer.from([0x50, 0x32, 0x56, 0x32, 0, 0, 0, 0]);

export function isP2mBuffer(input: Buffer): boolean {
  return input.length >= 72 && input.subarray(0, 4).equals(p2mMagic) && input.subarray(64, 72).equals(p2mPayloadMagic);
}

export class P2mReader {
  read(input: Buffer): ParsedP2mSave {
    if (!isP2mBuffer(input)) throw new Error("Not an Xploder P2M save file");
    const declaredSize = input.readUInt32LE(4);
    if (declaredSize !== input.length - 12) throw new Error(`P2M size mismatch: header=${declaredSize} actual=${input.length - 12}`);
    const description = readNullTerminatedAscii(input.subarray(8, 64));
    const save = new MdReader().read(input.subarray(72));
    return {
      type: "ps2", sourceFormat: "p2m", displayName: description || save.displayName,
      dirName: save.dirName, rootMode: save.rootMode, description, entries: save.entries, rawInput: input,
    };
  }
}
